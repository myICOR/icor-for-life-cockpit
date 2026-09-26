// app.js - the Cockpit's HTTP surface. Every data route is a GET that reads
// the in-memory index or one jailed file. The single write is POST
// /api/settings, and it writes the Cockpit's own settings file, never a vault.
//
// Exported as a factory so the tests can mount it on an ephemeral port.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containedPath, servedPath } from './jail.js';
import { SCHEMA, SCHEMA_ID, conceptPath } from './schema.js';
import { readSettings, writeSettings } from './settings.js';
import {
  CONCEPTS, CONCEPT_KEYS, CONCEPT_LABEL, CONCEPT_SINGLE, conceptCounts, listConcept,
  resolveTarget, allMatches, splitKnownFields, MAX_NOTE_BYTES,
} from './contentIndex.js';
import { splitFrontmatter, findWikilinks, asText, excerpt } from './frontmatter.js';
import { neighbourhood } from './graph.js';
import { plannerBoard, readCalendarMarkdown, isoDate } from './planner.js';
import { readSnapshot, SNAPSHOT_REL } from './snapshot.js';
import { teamAnalytics } from './analytics.js';
import { readTeamBody } from './agentsIndex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
const INLINE_MIME = {
  ...IMAGE_MIME,
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};
const EMBED_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; object-src 'self'; style-src 'unsafe-inline'";

// Content rooms a file preview may read (05 Assets for the Documents preview:
// PDFs, images, text, audio). 06 AI Team, 07 Databases and dot folders never,
// judged on the real file after symlinks (D5 M2).
const PREVIEW_ROOMS = ['00 Daily Scratchpad', '01 Inbox', '02 Planner', '03 WiP', '04 Inner World', '05 Assets'];
const CONTENT_DENY = ['06 AI Team/', '07 Databases/'];
const TEAM_DENY = ['06 AI Team/AI Sessions/'];

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "frame-src 'self'",
  "object-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

function obsidianUri(root, rel) {
  return `obsidian://open?vault=${encodeURIComponent(path.basename(root))}&file=${encodeURIComponent(rel)}`;
}

function intParam(v, def, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function createApp(store, { port = 4317 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const S = store.state;

  // Loopback only, and a DNS-rebinding guard: a hostile page that points its
  // own domain at 127.0.0.1 arrives with a foreign Host header and is refused.
  app.use((req, res, next) => {
    const host = String(req.get('Host') || '').toLowerCase();
    const ok = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
    if (!ok) return res.status(421).json({ error: 'misdirected request' });
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    return next();
  });

  // D5 L2: no other site may load Cockpit responses as subresources (an <img>
  // or <iframe> on a foreign page would reveal which files exist). Browsers
  // send Sec-Fetch-Site; `none` is a URL typed or bookmarked by the user.
  // D6 H1: a top-level GET navigation to the app shell (a link in a README or
  // on a web page) is let through; it reveals nothing the page could read.
  app.use((req, res, next) => {
    const site = req.get('Sec-Fetch-Site');
    const isDocNav = req.method === 'GET'
      && req.get('Sec-Fetch-Mode') === 'navigate'
      && req.get('Sec-Fetch-Dest') === 'document'
      // Express matches routes without regard to case, so this check must too (D5 L8).
      && !/^\/api(\/|$)/i.test(req.path);
    if (site && site !== 'same-origin' && site !== 'none' && !isDocNav) return res.status(403).json({ error: 'forbidden' });
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    return next();
  });

  const safe = (handler) => (req, res) => {
    try {
      const out = handler(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (err) {
      console.error(`[${req.path}]`, err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(500).json({ error: 'internal error' });
    }
  };

  const needContent = (res) => {
    if (S.content) return true;
    res.status(503).json({ error: 'no_content_root', reason: S.roots?.content?.reason ?? 'not set' });
    return false;
  };
  const needAgents = (res) => {
    if (S.agents) return true;
    res.status(404).json({ error: 'no_agents_root', reason: S.roots?.agents?.reason ?? 'not-set' });
    return false;
  };

  // ---- Status and settings --------------------------------------------------
  app.get('/api/health', (req, res) => res.json({ ok: true, version: PKG.version }));

  app.get('/api/status', safe(() => {
    const r = S.roots;
    return {
      version: PKG.version,
      schema: { id: SCHEMA_ID, version: SCHEMA.schema_version },
      content: r?.content.ok
        ? { ok: true, root: r.content.root, vault: path.basename(r.content.root), unverified: r.content.unverified, version: r.content.version }
        : { ok: false, reason: r?.content.reason ?? 'not set' },
      agents: r?.agents.ok
        ? { ok: true, root: r.agents.root }
        : { ok: false, set: Boolean(r?.agentsSet), reason: r?.agents.reason ?? 'not-set' },
      mode: r?.mode ?? null,
      counts: S.content ? conceptCounts(S.content) : null,
      agentCount: S.agents?.agents.length ?? 0,
      scannedAt: S.scannedAt,
      scanMs: S.scanMs,
      error: S.error,
    };
  }));

  app.get('/api/settings', safe(() => {
    const s = readSettings();
    return {
      contentRoot: s.contentRoot,
      agentsRoot: s.agentsRoot,
      lockedByEnv: s.lockedByEnv,
      resolveCheck: 'python3 "06 AI Team/AI Team Knowledge/Scripts/resolve.py" --check',
    };
  }));

  // The one write: two absolute paths into the Cockpit's own settings file.
  // CSRF belt: a custom header (no cross-site form can send it without a CORS
  // preflight, and none is granted) plus a same-origin Origin when present.
  const settingsJson = express.json({ limit: '8kb' });
  app.post('/api/settings', (req, res, next) => {
    if (req.get('X-Cockpit') !== '1') return res.status(403).json({ error: 'forbidden' });
    const origin = req.get('Origin');
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return next();
  }, settingsJson, safe((req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const current = readSettings();
    const next = {
      contentRoot: typeof body.contentRoot === 'string' ? body.contentRoot : current.contentRoot,
      agentsRoot: typeof body.agentsRoot === 'string' ? body.agentsRoot : current.agentsRoot,
    };
    try {
      writeSettings(next);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'invalid settings' });
      return undefined;
    }
    store.rebuild();
    return { ok: true };
  }));

  // ---- Navigation and dashboard ---------------------------------------------
  app.get('/api/nav', safe(() => {
    const counts = S.content ? conceptCounts(S.content) : null;
    return {
      content: Boolean(S.content),
      unverified: Boolean(S.roots?.content?.ok && S.roots.content.unverified),
      agents: Boolean(S.agents),
      types: CONCEPTS
        .filter((c) => ['key_elements', 'goals', 'projects', 'habits', 'topics', 'people', 'companies', 'notes'].includes(c.key))
        .map((c) => ({ type: c.key, label: c.label, count: counts?.[c.key] ?? 0 })),
      documents: counts?.documents ?? 0,
    };
  }));

  app.get('/api/dashboard', safe((req, res) => {
    if (!needContent(res)) return undefined;
    const idx = S.content;
    const snap = readSnapshot(idx.root);
    const today = isoDate(new Date());
    const board = plannerBoard(idx.root, { from: today, to: today });
    const col = board.columns[0];
    const recent = (concept, n) => listConcept(idx, concept).items.slice(0, n);
    const recentNotes = idx.notes
      .filter((x) => x.concept === 'notes')
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 6)
      .map((x) => ({ path: x.path, name: x.name, title: x.title, type: x.type, date: x.date }));
    return {
      today,
      vault: path.basename(idx.root),
      snapshot: { status: snap.status, reason: snap.reason ?? null, ageHours: snap.ageHours ?? null, data: snap.snapshot ?? null, path: SNAPSHOT_REL },
      counts: conceptCounts(idx),
      planner: {
        items: [...col.am, ...col.pm, ...col.anytime],
        habits: board.habitDays[today] ?? [],
        routines: board.routineDays[today] ?? [],
        week: board.week,
        calendar: board.calendar,
        counts: board.counts,
      },
      recentJournal: recent('journal', 5),
      recentNotes,
      inbox: {
        captures: idx.notes.filter((x) => x.concept === 'inbox' && !x.path.includes('/archive/') && x.fm.processed !== true).length,
      },
    };
  }));

  // ---- Knowledge ------------------------------------------------------------
  app.get('/api/list/:concept', safe((req, res) => {
    if (!needContent(res)) return undefined;
    let concept = req.params.concept;
    let filterType = null;
    if (concept === 'documents') {
      concept = 'notes';
      filterType = 'document';
    }
    if (!CONCEPT_KEYS.includes(concept)) {
      res.status(404).json({ error: 'unknown concept' });
      return undefined;
    }
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 200) : null;
    const typeQ = typeof req.query.type === 'string' ? req.query.type : null;
    const limit = intParam(req.query.limit, 500, 1, 5000);
    const offset = intParam(req.query.offset, 0, 0, 1e6);
    const list = listConcept(S.content, concept, { filterType: filterType ?? typeQ, q });
    return {
      type: req.params.concept,
      label: req.params.concept === 'documents' ? 'Documents' : CONCEPT_LABEL[concept],
      total: list.items.length,
      columns: list.columns,
      items: list.items.slice(offset, offset + limit),
    };
  }));

  // Document notes (type: document) as cards, with the binary each wraps.
  app.get('/api/documents', safe((req, res) => {
    if (!needContent(res)) return undefined;
    const idx = S.content;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 200) : '';
    let docs = idx.notes.filter((n) => n.concept === 'notes' && n.type === 'document');
    if (q) {
      docs = docs.filter((n) => n.title.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q)
        || Object.values(n.fm).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)));
    }
    const dateOf = (n) => asText(n.fm.issued_on)?.slice(0, 10) ?? n.date;
    docs.sort((a, b) => String(dateOf(b) ?? '').localeCompare(String(dateOf(a) ?? '')) || a.title.localeCompare(b.title));
    const items = docs.map((n, i) => {
      const target = findWikilinks(asText(n.fm.source_file) ?? '')[0]?.target;
      const pdfPath = target ? (idx.assetsByName.get(path.basename(target).toLowerCase()) ?? null) : null;
      const connections = [];
      for (const l of n.links) {
        if (l.embed || l.field === 'source_file') continue;
        const t = resolveTarget(idx, l.target);
        if (!t || connections.some((c) => c.path === t.path)) continue;
        connections.push({ slug: t.name, path: t.path, type: t.concept, title: t.title, direction: 'outbound', clickable: true });
      }
      for (const b of idx.backlinks.get(n.path) ?? []) {
        if (connections.some((c) => c.path === b.from.path)) continue;
        connections.push({ slug: b.from.name, path: b.from.path, type: b.from.concept, title: b.from.title, direction: 'backlink', clickable: true });
      }
      const { known } = splitKnownFields(n);
      return {
        id: i, slug: n.name, path: n.path, title: n.title, doc_type: asText(n.fm.doc_type),
        metadata: known, pdfPath, date: dateOf(n), filePath: n.path, connections,
      };
    });
    return { items, total: items.length, mode: 'text', q: q || undefined };
  }));

  function noteByQuery(req) {
    const idx = S.content;
    if (typeof req.query.path === 'string' && req.query.path) {
      const rel = req.query.path.replace(/\\/g, '/');
      return idx.byPath.get(rel) ?? null;
    }
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    const concept = typeof req.query.concept === 'string' ? req.query.concept : null;
    if (concept && CONCEPT_KEYS.includes(concept)) {
      return idx.byConceptName.get(`${concept}/${name.toLowerCase()}`) ?? resolveTarget(idx, name, concept);
    }
    return resolveTarget(idx, name);
  }

  function assembleNote(n) {
    const idx = S.content;
    const abs = containedPath(idx.root, n.path);
    let body = '';
    if (abs) {
      try {
        const st = fs.statSync(abs);
        if (st.size <= MAX_NOTE_BYTES) body = splitFrontmatter(fs.readFileSync(abs, 'utf8')).body;
      } catch {
        body = '';
      }
    }
    const { known, raw } = splitKnownFields(n);
    const outbound = [];
    const seen = new Set();
    for (const l of findWikilinks(body).concat(n.links.filter((x) => x.field))) {
      const key = `${l.embed ? '!' : ''}${l.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (l.embed) {
        outbound.push({ raw: l.target, slug: l.target, targetType: null, title: null, linkType: 'embed', clickable: false });
        continue;
      }
      const t = resolveTarget(idx, l.target);
      outbound.push({
        raw: l.target,
        slug: t ? t.name : l.target,
        targetType: t ? t.concept : null,
        title: t ? t.title : null,
        path: t ? t.path : null,
        linkType: 'wikilink',
        clickable: Boolean(t),
      });
    }
    const backlinks = (idx.backlinks.get(n.path) ?? []).map((b) => ({
      sourceType: b.from.concept,
      slug: b.from.name,
      path: b.from.path,
      title: b.from.title,
      label: CONCEPT_SINGLE[b.from.concept] ?? b.from.concept,
      field: b.field,
      clickable: true,
    }));
    // Images: embeds that resolve to a file under 05 Assets.
    const images = [];
    for (const l of findWikilinks(body)) {
      if (!l.embed || !/\.(png|jpe?g|gif|webp|svg)$/i.test(l.target)) continue;
      const rel = idx.assetsByName.get(path.basename(l.target).toLowerCase());
      if (rel) images.push({ path: rel, mediaType: 'image', caption: l.label && !/^\d+$/.test(l.label) ? l.label : null });
    }
    // A document's binary (source_file) previews inline when the type allows it.
    let preview = null;
    if (n.type === 'document' || n.type === 'pdf-highlight') {
      const target = findWikilinks(asText(n.fm.source_file) ?? '')[0]?.target;
      const rel = target ? (idx.assetsByName.get(path.basename(target).toLowerCase()) ?? null) : null;
      if (rel) {
        const ext = path.extname(rel).toLowerCase();
        const kind = ext === '.pdf' ? 'pdf' : IMAGE_MIME[ext] ? 'image' : ext === '.txt' ? 'text' : 'other';
        preview = { path: rel, kind, mime: INLINE_MIME[ext] ?? null, previewable: kind !== 'other', field: 'source_file', ext };
      }
    }
    return {
      type: n.concept,
      docType: n.type,
      slug: n.name,
      title: n.title,
      typeLabel: CONCEPT_SINGLE[n.concept] ?? n.concept,
      body,
      filePath: n.path,
      uri: obsidianUri(idx.root, n.path),
      metadata: known,
      rawFrontmatter: raw,
      unparsed: n.unparsed,
      preview,
      outbound,
      backlinks,
      journal: n.concept === 'journal' || n.concept === 'scratchpad' || n.concept === 'journey_notes'
        ? {
          entryDate: n.date,
          mood: asText(n.fm.mood),
          energy: null,
          category: asText(n.fm.journal_type) ?? asText(n.fm.category),
          entryType: asText(n.fm.format),
        }
        : undefined,
      media: { images, audioCount: 0, audio: null },
    };
  }

  app.get('/api/note', safe((req, res) => {
    if (!needContent(res)) return undefined;
    const n = noteByQuery(req);
    if (!n) return { found: false, slug: String(req.query.name ?? req.query.path ?? '') };
    const secondary = allMatches(S.content, n.name)
      .filter((m) => m !== n)
      .map((m) => ({ type: m.concept, slug: m.name, path: m.path, title: m.title, label: CONCEPT_SINGLE[m.concept] }));
    return { found: true, slug: n.name, note: assembleNote(n), secondary };
  }));

  app.get('/api/graph', safe((req, res) => {
    if (!needContent(res)) return undefined;
    const n = noteByQuery(req);
    if (!n) return { found: false, type: String(req.query.concept ?? ''), slug: String(req.query.name ?? '') };
    const depth = req.query.depth === '1' ? 1 : 2;
    return neighbourhood(S.content, n, { depth, cap: intParam(req.query.cap, 12, 1, 50) });
  }));

  app.get('/api/search', safe((req, res) => {
    if (!needContent(res)) return undefined;
    const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 200);
    const limit = intParam(req.query.limit, 30, 1, 100);
    if (q.length < 2) return { available: true, items: [] };
    const scored = [];
    for (const n of S.content.notes) {
      if (n.concept === 'planner') continue;
      const title = n.title.toLowerCase();
      let score = 0;
      if (title === q) score = 100;
      else if (title.startsWith(q)) score = 60;
      else if (title.includes(q)) score = 40;
      else if (n.excerpt.toLowerCase().includes(q)) score = 15;
      else if (Object.values(n.fm).some((v) => typeof v === 'string' && v.toLowerCase().includes(q))) score = 10;
      if (!score) continue;
      const ex = n.excerpt;
      const at = ex.toLowerCase().indexOf(q);
      const snippet = at === -1 ? ex.slice(0, 160) : ex.slice(Math.max(0, at - 60), at + q.length + 80);
      scored.push({ score, n, snippet });
    }
    scored.sort((a, b) => b.score - a.score || b.n.mtime - a.n.mtime);
    return {
      available: true,
      items: scored.slice(0, limit).map(({ n, snippet }) => ({
        type: n.concept, slug: n.name, path: n.path, entityId: null, title: n.title, snippet, label: CONCEPT_SINGLE[n.concept],
      })),
    };
  }));

  // Journal feed: journal entries (optionally with journey notes and
  // scratchpads), newest first, paged backwards by date.
  app.get('/api/journal', safe((req, res) => {
    if (!needContent(res)) return undefined;
    const kinds = String(req.query.kinds ?? 'journal').split(',').filter((k) => ['journal', 'journey_notes', 'scratchpad'].includes(k));
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const limit = intParam(req.query.limit, 20, 1, 100);
    let rows = S.content.notes.filter((n) => kinds.includes(n.concept) && n.date);
    rows.sort((a, b) => b.date.localeCompare(a.date) || b.mtime - a.mtime);
    if (before) rows = rows.filter((n) => n.date < before);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      entries: page.map((n) => ({
        slug: n.name,
        path: n.path,
        concept: n.concept,
        title: n.title,
        date: n.date,
        mood: asText(n.fm.mood),
        moodValence: null,
        energy: null,
        category: asText(n.fm.journal_type) ?? asText(n.fm.category) ?? (n.concept === 'scratchpad' ? 'scratchpad' : null),
        excerpt: n.excerpt,
        contentLength: n.bodyLength,
        images: n.links
          .filter((l) => l.embed && /\.(png|jpe?g|gif|webp)$/i.test(l.target))
          .map((l) => S.content.assetsByName.get(path.basename(l.target).toLowerCase()))
          .filter(Boolean),
      })),
      hasMore,
      nextBefore: hasMore && page.length ? page[page.length - 1].date : null,
    };
  }));

  // On this day: journal entries from the same calendar day one month, six
  // months and every year ago (calendar maths in code, never a model).
  app.get('/api/journal/on-this-day', safe((req, res) => {
    if (!needContent(res)) return undefined;
    const today = new Date();
    const shift = (months) => {
      const d = new Date(today.getFullYear(), today.getMonth() - months, today.getDate(), 12);
      return d.getDate() === today.getDate() ? isoDate(d) : null;
    };
    const targets = [
      { key: '1m', label: 'One month ago', date: shift(1) },
      { key: '6m', label: 'Six months ago', date: shift(6) },
    ];
    const journal = S.content.notes.filter((n) => n.concept === 'journal' && n.date);
    const md = isoDate(today).slice(5);
    const years = [...new Set(journal.map((n) => n.date.slice(0, 4)))]
      .filter((y) => Number(y) < today.getFullYear())
      .sort((a, b) => b.localeCompare(a));
    for (const y of years) {
      const n = today.getFullYear() - Number(y);
      targets.push({ key: `${n}y`, label: n === 1 ? 'One year ago' : `${n} years ago`, date: `${y}-${md}` });
    }
    const toEntry = (n) => ({
      slug: n.name,
      path: n.path,
      title: n.title,
      entryDate: n.date,
      content: n.excerpt,
      media: n.links
        .filter((l) => l.embed && /\.(png|jpe?g|gif|webp)$/i.test(l.target))
        .map((l) => S.content.assetsByName.get(path.basename(l.target).toLowerCase()))
        .filter(Boolean)
        .map((filePath) => ({ filePath, caption: null, mediaType: 'image' })),
    });
    const buckets = targets
      .filter((t) => t.date)
      .map((t) => ({ key: t.key, label: t.label, date: t.date, entries: journal.filter((n) => n.date === t.date).map(toEntry) }))
      .filter((b) => b.entries.length > 0);
    return { available: true, date: isoDate(today), buckets };
  }));

  // Folder trees for the Inbox, WiP and Scratchpad rooms (read-only).
  const TREE_ROOTS = {
    inbox: { label: 'Inbox', rel: conceptPath('inbox'), skip: [] },
    wip: { label: 'WiP', rel: conceptPath('wip'), skip: ['_archive'] },
    scratchpad: { label: 'Daily Scratchpad', rel: conceptPath('scratchpad'), skip: [] },
  };
  app.get('/api/tree', safe((req, res) => {
    if (!needContent(res)) return undefined;
    const spec = TREE_ROOTS[String(req.query.root ?? '')];
    if (!spec) {
      res.status(400).json({ error: 'unknown root' });
      return undefined;
    }
    const base = path.join(S.content.root, spec.rel);
    let budget = 3000;
    const walk = (abs, rel, depth) => {
      const children = [];
      if (depth > 6 || budget <= 0) return children;
      let entries = [];
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        return children;
      }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of entries) {
        if (budget <= 0) break;
        if (e.name.startsWith('.') || spec.skip.includes(e.name) || /^\.env/i.test(e.name)) continue;
        const childAbs = path.join(abs, e.name);
        const childRel = `${rel}/${e.name}`;
        budget -= 1;
        if (e.isDirectory()) {
          children.push({ name: e.name, path: childRel, kind: 'dir', children: walk(childAbs, childRel, depth + 1) });
        } else if (e.isFile()) {
          let st = null;
          try {
            st = fs.statSync(childAbs);
          } catch {
            continue;
          }
          children.push({ name: e.name, path: childRel, kind: 'file', size: st.size, mtime: st.mtimeMs });
        }
      }
      return children;
    };
    return {
      root: { name: spec.label, path: spec.rel, kind: 'dir', children: walk(base, spec.rel, 0) },
      truncated: budget <= 0,
    };
  }));

  // One file from a content room, inline, behind the strict embed CSP.
  app.get('/api/file', (req, res) => {
    if (!needContent(res)) return;
    const rel = String(req.query.path ?? '');
    const abs = servedPath(S.content.root, rel, { rooms: PREVIEW_ROOMS, denyPrefixes: CONTENT_DENY });
    if (!abs) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!st.isFile()) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = INLINE_MIME[ext];
    if (!mime) {
      res.status(415).json({ error: 'no inline preview for this type', ext });
      return;
    }
    if (mime.startsWith('text/') && st.size > MAX_NOTE_BYTES) {
      res.status(413).json({ error: 'file is larger than 2 MB' });
      return;
    }
    res.set('Content-Type', mime);
    res.set('Content-Disposition', 'inline');
    res.set('Content-Security-Policy', EMBED_CSP);
    res.sendFile(abs);
  });

  // Images only: from 05 Assets in the content root, or an agent avatar.
  app.get('/api/asset', (req, res) => {
    const which = req.query.root === 'agents' ? 'agents' : 'content';
    const rel = String(req.query.path ?? '');
    const ext = path.extname(rel).toLowerCase();
    if (!IMAGE_MIME[ext]) {
      res.status(415).json({ error: 'images only' });
      return;
    }
    let abs = null;
    const assetRooms = { rooms: [conceptPath('assets')], denyPrefixes: CONTENT_DENY };
    if (which === 'content' && S.content && rel.startsWith(`${conceptPath('assets')}/`)) {
      abs = servedPath(S.content.root, rel, assetRooms);
    } else if (which === 'content' && S.content) {
      // An embed name ("garden.png", or a partial path), resolved by file name
      // the way the vault does; only files under 05 Assets are ever found.
      const found = S.content.assetsByName.get(path.basename(rel).toLowerCase());
      if (found) abs = servedPath(S.content.root, found, assetRooms);
    } else if (which === 'agents' && S.agents) {
      const allowed = S.agents.agents.some((a) => a.avatar === rel);
      if (allowed) abs = servedPath(S.agents.root, rel, { rooms: ['06 AI Team'], denyPrefixes: TEAM_DENY });
    }
    if (!abs) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.set('Content-Type', IMAGE_MIME[ext]);
    res.set('Content-Security-Policy', EMBED_CSP);
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(abs);
  });

  // ---- Planner --------------------------------------------------------------
  app.get('/api/planner', safe((req, res) => {
    if (!needContent(res)) return undefined;
    return plannerBoard(S.content.root, {
      from: typeof req.query.from === 'string' ? req.query.from : null,
      to: typeof req.query.to === 'string' ? req.query.to : null,
    });
  }));
  app.get('/api/planner/calendar', safe((req, res) => {
    if (!needContent(res)) return undefined;
    return readCalendarMarkdown(S.content.root);
  }));

  // ---- Team (optional agents root) -----------------------------------------
  const agentOut = (a) => ({
    slug: a.slug, name: a.name, role: a.role, folder: a.folder, status: a.status,
    bio: a.bio, avatarPath: a.avatar, routing: a.routing, myicorId: a.myicorId,
  });
  app.get('/api/team/agents', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    return { agents: S.agents.agents.map(agentOut) };
  }));
  app.get('/api/team/agent/:slug', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    const a = S.agents.agents.find((x) => x.slug === req.params.slug);
    if (!a) return { found: false };
    const logs = S.agents.sessionLogs.filter((l) => l.agents.includes(a.slug));
    const tasks = S.agents.tasks.filter((t) => t.assignee === a.slug);
    return {
      found: true,
      agent: {
        ...agentOut(a),
        contractBody: a.contractBody,
        bioBody: a.bioBody,
        frontmatter: a.frontmatter,
        uri: obsidianUri(S.agents.root, a.contractPath),
        stats: {
          sessions: logs.length,
          lastSession: logs[0]?.day ?? null,
          insights: S.agents.insights.filter((i) => i.agent === a.slug).length,
          tasksOpen: tasks.filter((t) => t.state === 'open' || t.state === 'in-progress').length,
          tasksDone: tasks.filter((t) => t.state === 'done').length,
        },
      },
    };
  }));
  app.get('/api/team/agent/:slug/journal', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    const entries = S.agents.insights.filter((i) => i.agent === req.params.slug).slice(0, 200);
    return {
      available: true,
      entries: entries.map((i) => ({ ...i, body: readTeamBody(S.agents.root, i.path), contentLength: i.bodyLength })),
    };
  }));
  app.get('/api/team/insights', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    const limit = intParam(req.query.limit, 50, 1, 500);
    const agent = typeof req.query.agent === 'string' ? req.query.agent : null;
    const rows = S.agents.insights.filter((i) => !agent || i.agent === agent);
    return { total: rows.length, entries: rows.slice(0, limit).map((i) => ({ ...i, contentLength: i.bodyLength })) };
  }));
  app.get('/api/team/session-logs', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    const limit = intParam(req.query.limit, 20, 1, 100);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const agent = typeof req.query.agent === 'string' ? req.query.agent : null;
    let rows = S.agents.sessionLogs.filter((l) => !agent || l.agents.includes(agent));
    if (before) rows = rows.filter((l) => l.timestamp < before);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      available: true,
      entries: page.map((l) => ({
        slug: l.slug, title: l.title, agent: l.agent, agents: l.agents, type: l.type, timestamp: l.timestamp,
        date: l.day, excerpt: l.excerpt, body: readTeamBody(S.agents.root, l.path), contentLength: l.bodyLength, filePath: l.path,
        uri: obsidianUri(S.agents.root, l.path),
      })),
      hasMore,
      nextBefore: hasMore && page.length ? page[page.length - 1].timestamp : null,
    };
  }));
  app.get('/api/team/tasks', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    return { tasks: S.agents.tasks.map((t) => ({ ...t, uri: obsidianUri(S.agents.root, t.path) })) };
  }));
  app.get('/api/team/analytics', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    return teamAnalytics(S.agents, {
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });
  }));
  app.get('/api/team/ai-sessions', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    // q7c: metadata and an Obsidian link only, never the transcript.
    return { sessions: S.agents.aiSessions.map((s) => ({ ...s, uri: obsidianUri(S.agents.root, s.path) })) };
  }));
  app.get('/api/team/knowledge/:family', safe((req, res) => {
    if (!needAgents(res)) return undefined;
    const family = req.params.family;
    if (!['sops', 'workstreams', 'guidelines'].includes(family)) {
      res.status(404).json({ error: 'unknown family' });
      return undefined;
    }
    return {
      available: true,
      family,
      items: S.agents.knowledge[family].map((k) => ({ ...k, filePath: k.path, uri: obsidianUri(S.agents.root, k.path) })),
    };
  }));
  // A team markdown file as text (SOPs, Workstreams, Guidelines, contracts).
  // AI Session transcripts are refused (q7c).
  app.get('/api/team/file', (req, res) => {
    if (!needAgents(res)) return;
    const rel = String(req.query.path ?? '');
    // q7c: transcripts are refused on the REAL file, whatever the spelling (D5 M1).
    const abs = servedPath(S.agents.root, rel, { rooms: ['06 AI Team'], denyPrefixes: TEAM_DENY });
    if (!abs || !abs.toLowerCase().endsWith('.md')) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_NOTE_BYTES) {
        res.status(413).json({ error: 'too large' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.set('Content-Security-Policy', EMBED_CSP);
    res.sendFile(abs);
  });

  // Unknown /api/* answers JSON 404, never the SPA shell.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'unknown api route', hint: 'The server may be older than the page. Restart the Cockpit.' });
  });

  // ---- The built web app ----------------------------------------------------
  const dist = path.resolve(__dirname, '..', 'web', 'dist');
  const setAppCsp = (res) => {
    res.set('Content-Security-Policy', APP_CSP);
  };
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { setHeaders: setAppCsp, index: false }));
    app.get('*', (req, res) => {
      // A missing asset (anything with a file extension) is a 404, not the shell.
      if (/\.[a-z0-9]+$/i.test(req.path)) {
        res.status(404).type('text/plain').send('not found');
        return;
      }
      setAppCsp(res);
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => res.type('text/plain').send('The Cockpit is not built yet. Run: npm run build'));
  }

  // JSON error handler, never an HTML stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'malformed JSON body' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'request body too large' });
    console.error('[unhandled]', err && err.message);
    return res.status(500).json({ error: 'internal error' });
  });

  app.locals.port = port;
  return app;
}
