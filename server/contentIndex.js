// contentIndex.js - the in-memory index over the ICOR for Life content root.
//
// One scan reads every markdown note in the content concepts, keeps its
// frontmatter, its outgoing wikilinks and a short excerpt, and throws the body
// away. Bodies are read again only when a note is opened. Nothing is written
// anywhere: no cache file, no lock file (D2 section 8). WiP is metadata only:
// folder names and progress-report frontmatter, never the 5,000+ file bodies.
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA, conceptPath, slotPath } from './schema.js';
import { splitFrontmatter, findWikilinks, frontmatterLinks, asText, excerpt, linkNames } from './frontmatter.js';
import { isDeniedName, toRel } from './jail.js';

export const MAX_NOTE_BYTES = 2 * 1024 * 1024;

// The knowledge concepts the index lists, in navigation order, with labels.
export const CONCEPTS = [
  { key: 'key_elements', label: 'Key Elements', single: 'Key Element' },
  { key: 'goals', label: 'Goals', single: 'Goal' },
  { key: 'projects', label: 'Projects', single: 'Project' },
  { key: 'habits', label: 'Habits', single: 'Habit' },
  { key: 'topics', label: 'Topics', single: 'Topic' },
  { key: 'people', label: 'People', single: 'Person' },
  { key: 'companies', label: 'Companies', single: 'Company' },
  { key: 'notes', label: 'Notes', single: 'Note' },
  { key: 'journal', label: 'Journal', single: 'Journal entry' },
  { key: 'journey_notes', label: 'ICOR Journey Notes', single: 'Journey note' },
  { key: 'scratchpad', label: 'Daily Scratchpad', single: 'Scratchpad' },
  { key: 'inbox', label: 'Inbox', single: 'Capture' },
  { key: 'planner', label: 'Planner', single: 'Planner note' },
];
export const CONCEPT_KEYS = CONCEPTS.map((c) => c.key);
export const CONCEPT_LABEL = Object.fromEntries(CONCEPTS.map((c) => [c.key, c.label]));
export const CONCEPT_SINGLE = Object.fromEntries(CONCEPTS.map((c) => [c.key, c.single]));

// Wikilink collisions: which concept wins when two notes share a name.
const PRIORITY = [
  'people', 'companies', 'projects', 'goals', 'key_elements', 'topics', 'habits',
  'notes', 'journal', 'journey_notes', 'scratchpad', 'inbox', 'planner',
];

// Per concept: which frontmatter field is the list subtitle, and which columns
// the list view shows. Field names are icor-concepts/1 names only.
const LIST_SHAPE = {
  key_elements: { sub: null, cols: [] },
  goals: { sub: 'status', cols: ['status', 'target_date', 'key_elements'] },
  projects: { sub: 'status', cols: ['status', 'goal', 'focus_rank', 'end_date'] },
  habits: { sub: 'status', cols: ['status'] },
  topics: { sub: null, cols: ['related_topics'] },
  people: { sub: 'role', cols: ['role', 'companies', 'last_contact', 'next_action'] },
  companies: { sub: 'industry', cols: ['industry', 'people'] },
  notes: { sub: 'note_type', cols: ['type', 'note_type', 'doc_type', 'idea_status'] },
  journal: { sub: 'journal_type', cols: ['date', 'journal_type', 'mood'] },
  journey_notes: { sub: 'category', cols: ['category', 'reflected_at'] },
  scratchpad: { sub: null, cols: ['date', 'processed'] },
  inbox: { sub: 'source_url', cols: ['captured', 'processed'] },
  planner: { sub: 'type', cols: ['type', 'status'] },
};

function walkMarkdown(absDir, { recursive = true, skipDirs = [] } = {}) {
  const out = [];
  const stack = [absDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || isDeniedName(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive && !skipDirs.includes(abs)) stack.push(abs);
      } else if (e.isFile() && e.name.toLowerCase() === 'readme.md') {
        // A folder README explains the room; it is not a note (D6 M1).
        continue;
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(abs);
      }
    }
  }
  return out;
}

function readNote(abs) {
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_NOTE_BYTES) return { st, text: null };
  try {
    return { st, text: fs.readFileSync(abs, 'utf8') };
  } catch {
    return { st, text: null };
  }
}

/** The best display date for a note, as written (never re-formatted). */
function noteDate(concept, fm, name) {
  const keys = {
    journal: ['date'], scratchpad: ['date'], journey_notes: ['reflected_at'], inbox: ['captured'],
    goals: ['target_date'], projects: ['start_date'],
  }[concept] ?? [];
  for (const k of [...keys, 'created']) {
    const v = asText(fm[k]);
    if (v) return v.slice(0, 10);
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(name);
  return m ? m[1] : null;
}

function noteTitle(concept, fm, name) {
  if (concept === 'planner') return asText(fm.title) || asText(fm.name) || name;
  if (concept === 'people' || concept === 'companies' || concept === 'habits') return asText(fm.name) || name;
  return name;
}

/** Build a fresh index of the content root. Pure read. */
export function buildContentIndex(root) {
  const started = Date.now();
  const notes = [];
  const byPath = new Map(); // vault-rel path (with .md) -> note
  const byName = new Map(); // lowercased name -> notes[]
  const byConceptName = new Map(); // `${concept}/${lowercased name}` -> note

  const add = (concept, abs) => {
    const rel = toRel(root, abs);
    if (byPath.has(rel)) return;
    const read = readNote(abs);
    if (!read) return;
    const name = path.basename(abs).replace(/\.md$/i, '');
    const { fm, body, unparsed } = read.text == null
      ? { fm: {}, body: '', unparsed: true }
      : splitFrontmatter(read.text);
    const links = [...frontmatterLinks(fm), ...findWikilinks(body).map((l) => ({ ...l, field: null }))];
    const note = {
      path: rel,
      concept,
      type: asText(fm.type),
      name,
      title: noteTitle(concept, fm, name),
      fm,
      unparsed,
      mtime: read.st.mtimeMs,
      size: read.st.size,
      date: noteDate(concept, fm, name),
      excerpt: excerpt(body, 320),
      bodyLength: body.length,
      links,
    };
    notes.push(note);
    byPath.set(rel, note);
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(note);
    const ck = `${concept}/${key}`;
    if (!byConceptName.has(ck)) byConceptName.set(ck, note);
  };

  const conceptDir = (concept) => path.join(root, conceptPath(concept));
  for (const concept of ['key_elements', 'goals', 'projects', 'habits', 'topics', 'people', 'companies',
    'notes', 'journal', 'journey_notes', 'scratchpad']) {
    for (const abs of walkMarkdown(conceptDir(concept))) add(concept, abs);
  }
  // Inbox: the two text slots; the scanner slot holds binaries (listed in the tree).
  for (const slot of ['outer_world', 'outer_world_archive']) {
    for (const abs of walkMarkdown(path.join(root, slotPath('inbox', slot)), { recursive: false })) add('inbox', abs);
  }
  // Planner notes join the index so a project sees the items that link to it.
  for (const abs of walkMarkdown(conceptDir('planner'))) add('planner', abs);

  // Asset names for image embeds (journal photos live under 05 Assets).
  const assetsByName = new Map();
  const assetsRoot = path.join(root, conceptPath('assets'));
  const stack = [assetsRoot];
  let assetCount = 0;
  while (stack.length && assetCount < 50000) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) {
        assetCount += 1;
        const k = e.name.toLowerCase();
        if (!assetsByName.has(k)) assetsByName.set(k, toRel(root, abs));
      }
    }
  }

  const index = { root, notes, byPath, byName, byConceptName, assetsByName, builtAt: new Date().toISOString(), ms: 0 };

  // Backlinks: resolve every outgoing link once.
  const backlinks = new Map();
  for (const n of notes) {
    const seen = new Set();
    for (const l of n.links) {
      if (l.embed) continue;
      const t = resolveTarget(index, l.target);
      if (!t || t === n || seen.has(t.path)) continue;
      seen.add(t.path);
      if (!backlinks.has(t.path)) backlinks.set(t.path, []);
      backlinks.get(t.path).push({ from: n, field: l.field });
    }
  }
  index.backlinks = backlinks;
  index.ms = Date.now() - started;
  return index;
}

/**
 * Resolve a wikilink target the way the vault does: by note name, or by a
 * full path when the link carries a folder ("[[02 Planner/Habits/Walk]]").
 */
export function resolveTarget(index, target, preferConcept = null) {
  if (!target) return null;
  const t = target.replace(/\\/g, '/').replace(/\.md$/i, '').trim();
  if (t.includes('/')) {
    const exact = index.byPath.get(`${t}.md`);
    if (exact) return exact;
    const lower = `/${t.toLowerCase()}.md`;
    for (const n of index.notes) if (`/${n.path.toLowerCase()}`.endsWith(lower)) return n;
    return null;
  }
  const list = index.byName.get(t.toLowerCase());
  if (!list || list.length === 0) return null;
  if (preferConcept) {
    const hit = list.find((n) => n.concept === preferConcept);
    if (hit) return hit;
  }
  return [...list].sort((a, b) => PRIORITY.indexOf(a.concept) - PRIORITY.indexOf(b.concept))[0];
}

export function allMatches(index, target) {
  if (!target || target.includes('/')) return [];
  return [...(index.byName.get(target.toLowerCase()) ?? [])]
    .sort((a, b) => PRIORITY.indexOf(a.concept) - PRIORITY.indexOf(b.concept));
}

/** Count notes per listed concept (nav badges). */
export function conceptCounts(index) {
  const counts = Object.fromEntries(CONCEPT_KEYS.map((k) => [k, 0]));
  let documents = 0;
  for (const n of index.notes) {
    counts[n.concept] += 1;
    if (n.concept === 'notes' && n.type === 'document') documents += 1;
  }
  return { ...counts, documents };
}

function colValue(note, col) {
  if (col === 'type') return note.type;
  const v = note.fm[col];
  if (Array.isArray(v)) return linkNames(v).join(', ') || null;
  const s = asText(v);
  if (s == null) return null;
  return s.includes('[[') ? linkNames(s).join(', ') : s;
}

/** Rows for one concept, newest first for dated concepts, else by name. */
export function listConcept(index, concept, { filterType = null, q = null } = {}) {
  const shape = LIST_SHAPE[concept] ?? { sub: null, cols: [] };
  let rows = index.notes.filter((n) => n.concept === concept && (!filterType || n.type === filterType));
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((n) => n.title.toLowerCase().includes(needle) || n.excerpt.toLowerCase().includes(needle));
  }
  const dated = ['journal', 'scratchpad', 'journey_notes', 'inbox'].includes(concept);
  rows.sort(dated
    ? (a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.name.localeCompare(b.name)
    : (a, b) => a.title.localeCompare(b.title));
  return {
    columns: shape.cols,
    items: rows.map((n) => ({
      path: n.path,
      slug: n.name,
      title: n.title,
      docType: n.type,
      subtitle: shape.sub ? colValue(n, shape.sub) : null,
      date: n.date,
      cols: Object.fromEntries(shape.cols.map((c) => [c, colValue(n, c)])),
      unparsed: n.unparsed || undefined,
    })),
  };
}

/** The known-field split for a note: schema fields first, the rest raw. */
export function splitKnownFields(note) {
  const known = {};
  const raw = {};
  const typeDef = note.type ? SCHEMA.types[note.type] : null;
  const allowed = new Set([...Object.keys(typeDef?.fields ?? {}), ...Object.keys(SCHEMA.common_fields ?? {})]);
  for (const [k, v] of Object.entries(note.fm)) {
    if (allowed.has(k)) known[k] = v;
    else raw[k] = v;
  }
  return { known, raw };
}
