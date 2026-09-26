// agentsIndex.js - the optional agents root: roster, insights, session logs,
// tasks, AI Session metadata and team knowledge (D2 section 5).
//
// Paths are the fixed team concepts under the agents root (GL-1013 section
// 2.2), so there is no resolver here. Both the myPKA 6 shapes and the legacy
// v5 shapes are read (decision m2v): a v6 session log carries `date` and an
// `agents` list, a v5 one carries `agent_id` and `timestamp`. AI Session
// transcripts are never read past their frontmatter (decision q7c).
import fs from 'node:fs';
import path from 'node:path';
import { teamPath } from './schema.js';
import { splitFrontmatter, asText, excerpt, findWikilinks, linkNames } from './frontmatter.js';
import { isDeniedName, toRel } from './jail.js';

const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

function readText(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return { st, text: fs.readFileSync(abs, 'utf8') };
  } catch {
    return null;
  }
}

/** Read only the frontmatter block (for the AI Session files: never the body). */
function readFrontmatterOnly(abs) {
  let fd;
  try {
    fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n).toString('utf8');
    const { fm } = splitFrontmatter(head);
    return fm;
  } catch {
    return {};
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function dirs(abs) {
  try {
    return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

function mdFiles(abs, recursive = false) {
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || isDeniedName(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && recursive) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
    }
  }
  return out;
}

function slugOf(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Section text under a `## Heading` (up to the next heading of level <= 2). */
function section(body, heading) {
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (at === -1) return null;
  const out = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim() || null;
}

function roster(root) {
  const agentsDir = path.join(root, teamPath('agents'));
  const avatarsDir = path.join(root, path.dirname(teamPath('sops')), 'Avatars');
  const agents = [];
  for (const d of dirs(agentsDir)) {
    const folder = path.join(agentsDir, d.name);
    const contract = readText(path.join(folder, 'AGENT.md'));
    if (!contract) continue;
    const { fm, body } = splitFrontmatter(contract.text);
    // The myPKA hire template carries the nil id; it is never a specialist (D6 M2).
    if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(asText(fm.myicor_id) ?? '')) continue;
    const bioFile = readText(path.join(folder, `${d.name}.md`));
    const bio = bioFile ? splitFrontmatter(bioFile.text) : { fm: {}, body: '' };
    const name = asText(fm.name) ?? d.name;
    const slug = slugOf(name);
    const role = asText(fm.role) ?? asText(bio.fm.role);

    // Avatar: the first image embed in the bio, looked up in the agent's own
    // folder, then in AI Team Knowledge/Avatars; else Avatars/<slug>.png.
    let avatar = null;
    const embeds = findWikilinks(bio.body).filter((l) => l.embed && IMAGE_EXT.test(l.target));
    const candidates = [...embeds.map((e) => path.basename(e.target)), `${slug}.png`];
    for (const c of candidates) {
      for (const dir of [folder, avatarsDir]) {
        const abs = path.join(dir, c);
        try {
          if (fs.statSync(abs).isFile()) {
            avatar = toRel(root, abs);
            break;
          }
        } catch {
          /* try the next candidate */
        }
      }
      if (avatar) break;
    }

    agents.push({
      slug,
      name,
      role,
      folder: toRel(root, folder),
      myicorId: asText(fm.myicor_id),
      status: asText(fm.agent_status) ?? 'active',
      routing: asText(fm.routing_description),
      bio: excerpt(bio.body.replace(/^\s*#\s+[^\n]*\n+/, ''), 400) || asText(fm.bio) || '',
      bioBody: bio.body,
      avatar,
      contractPath: toRel(root, path.join(folder, 'AGENT.md')),
      contractBody: body,
      frontmatter: fm,
    });
  }
  agents.sort((a, b) => (a.slug === 'larry' ? -1 : b.slug === 'larry' ? 1 : a.name.localeCompare(b.name)));
  return agents;
}

function insights(root, agents) {
  const out = [];
  for (const a of agents) {
    const dir = path.join(root, a.folder, 'Journal');
    for (const abs of mdFiles(dir)) {
      const base = path.basename(abs);
      if (base.startsWith('_')) continue;
      const r = readText(abs);
      if (!r) continue;
      const { fm, body } = splitFrontmatter(r.text);
      const title = (/^#\s+(.+)$/m.exec(body)?.[1] ?? base.replace(/\.md$/i, '')).trim();
      const created = asText(fm.created) ?? asText(fm.timestamp) ?? (/^(\d{4}-\d{2}-\d{2})/.exec(base)?.[1] ?? null);
      out.push({
        agent: a.slug,
        agentName: a.name,
        path: toRel(root, abs),
        slug: base.replace(/\.md$/i, ''),
        title,
        topic: asText(fm.topic),
        created,
        updated: asText(fm.updated),
        status: asText(fm.status) === 'superseded' ? 'superseded' : 'durable',
        learned: section(body, 'What I learned'),
        applies: section(body, 'When this applies'),
        excerpt: excerpt(body, 400),
        bodyLength: body.length,
        linkedSessionLogs: linkNames(fm.linked_session_logs),
        tags: Array.isArray(fm.tags) ? fm.tags.map(asText).filter(Boolean) : [],
      });
    }
  }
  out.sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
  return out;
}

const LOG_NAME = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})_([^_]+)_(.+)\.md$/;

function sessionLogs(root) {
  const dir = path.join(root, teamPath('session_logs'));
  const out = [];
  for (const abs of mdFiles(dir, true)) {
    const base = path.basename(abs);
    if (base.startsWith('_') || base.toLowerCase() === 'readme.md') continue;
    const r = readText(abs);
    if (!r) continue;
    const { fm, body } = splitFrontmatter(r.text);
    const m = LOG_NAME.exec(base);
    let agents = [];
    let day = null;
    let shape = null;
    if (Array.isArray(fm.agents)) {
      shape = 'v6';
      agents = linkNames(fm.agents).map(slugOf);
      day = asText(fm.date)?.slice(0, 10) ?? (m ? `${m[1]}-${m[2]}-${m[3]}` : null);
    } else if (fm.agent_id) {
      shape = 'v5';
      agents = [slugOf(asText(fm.agent_id))];
      day = asText(fm.timestamp)?.slice(0, 10) ?? (m ? `${m[1]}-${m[2]}-${m[3]}` : null);
    } else if (m) {
      shape = 'name';
      agents = [slugOf(m[6])];
      day = `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (!day) continue;
    const minute = m ? `${m[4]}:${m[5]}` : null;
    const title = (/^#\s+(.+)$/m.exec(body)?.[1] ?? (m ? m[7].replace(/-/g, ' ') : base)).trim();
    out.push({
      path: toRel(root, abs),
      slug: base.replace(/\.md$/i, ''),
      title,
      agents,
      agent: agents[0] ?? null,
      day,
      timestamp: minute ? `${day}T${minute}` : asText(fm.timestamp) ?? day,
      type: asText(fm.type),
      shape,
      excerpt: excerpt(body, 400),
      bodyLength: body.length,
    });
  }
  out.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return out;
}

const TASK_STATES = ['open', 'in-progress', 'done', 'cancelled'];

function tasks(root) {
  const base = path.join(root, teamPath('tasks'));
  const out = [];
  for (const state of TASK_STATES) {
    const stateDir = path.join(base, state);
    // open / in-progress are flat; done / cancelled nest YYYY/MM. A promoted
    // task is a folder <stem>/<stem>.md with a deliverables/ folder.
    for (const abs of mdFiles(stateDir, true)) {
      const rel = path.relative(stateDir, abs).split(path.sep);
      const base2 = path.basename(abs, '.md');
      if (base2.startsWith('_') || base2.toLowerCase() === 'readme') continue;
      if (rel.includes('deliverables')) continue;
      const parent = rel.length >= 2 ? rel[rel.length - 2] : null;
      if (rel.length >= 2 && parent !== base2 && !/^\d{2}$/.test(parent)) continue;
      const r = readText(abs);
      if (!r) continue;
      const { fm, body } = splitFrontmatter(r.text);
      let month = null;
      const ym = rel.slice(0, 2);
      if ((state === 'done' || state === 'cancelled') && /^\d{4}$/.test(ym[0] ?? '') && /^\d{2}$/.test(ym[1] ?? '')) {
        month = `${ym[0]}-${ym[1]}`;
      }
      const fieldStatus = asText(fm.status);
      out.push({
        path: toRel(root, abs),
        slug: base2,
        title: (/^#\s+(.+)$/m.exec(body)?.[1] ?? base2).trim(),
        state,
        status: fieldStatus,
        disagrees: fieldStatus != null && fieldStatus !== state,
        assignee: slugOf(linkNames(fm.assignee)[0] ?? asText(fm.assignee) ?? '') || null,
        due: asText(fm.due)?.slice(0, 10) ?? null,
        created: asText(fm.created)?.slice(0, 10) ?? null,
        month,
        related: linkNames(fm.related),
      });
    }
  }
  return out;
}

function aiSessions(root) {
  const dir = path.join(root, teamPath('ai_sessions'));
  const out = [];
  for (const d of dirs(dir)) {
    const abs = path.join(dir, d.name, 'conversation.md');
    try {
      if (!fs.statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    const fm = readFrontmatterOnly(abs);
    out.push({
      path: toRel(root, abs),
      folder: d.name,
      title: asText(fm.title) ?? d.name,
      date: asText(fm.date)?.slice(0, 10) ?? (/^(\d{4}-\d{2}-\d{2})/.exec(d.name)?.[1] ?? null),
      source: asText(fm.source),
      provider: asText(fm.provider),
    });
  }
  out.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return out;
}

function knowledge(root, family) {
  const dir = path.join(root, teamPath(family));
  const out = [];
  for (const abs of mdFiles(dir)) {
    const base = path.basename(abs, '.md');
    if (base.startsWith('_') || base.toLowerCase() === 'readme') continue;
    const r = readText(abs);
    if (!r) continue;
    const { fm, body } = splitFrontmatter(r.text);
    out.push({
      path: toRel(root, abs),
      slug: base,
      docId: asText(fm.id) ?? (/^((?:SOP|WS|GL)-\d+)/.exec(base)?.[1] ?? null),
      title: asText(fm.title) ?? base,
      owner: asText(fm.owner),
      uses: linkNames(fm.uses),
      summary: asText(fm.skill_summary) ?? excerpt(body, 220),
    });
  }
  out.sort((a, b) => String(a.docId ?? a.slug).localeCompare(String(b.docId ?? b.slug), undefined, { numeric: true }));
  return out;
}

/**
 * The markdown body of one indexed team file, read on demand (bodies are not
 * kept in memory: a real team folder holds thousands of logs).
 */
export function readTeamBody(root, rel) {
  const r = readText(path.join(root, rel));
  return r ? splitFrontmatter(r.text).body : '';
}

/** Build the agents index. Pure read. */
export function buildAgentsIndex(root) {
  const started = Date.now();
  const agents = roster(root);
  const index = {
    root,
    agents,
    insights: insights(root, agents),
    sessionLogs: sessionLogs(root),
    tasks: tasks(root),
    aiSessions: aiSessions(root),
    knowledge: {
      sops: knowledge(root, 'sops'),
      workstreams: knowledge(root, 'workstreams'),
      guidelines: knowledge(root, 'guidelines'),
    },
    builtAt: new Date().toISOString(),
  };
  index.ms = Date.now() - started;
  return index;
}
