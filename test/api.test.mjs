// api.test.mjs - the HTTP surface: GET-only data routes, the jail on every
// file route, the DNS-rebinding guard, and that nothing is ever written to
// either root.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeRoots, startApp, rmrf } from './helpers.mjs';

function treeDigest(root) {
  const h = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.statSync(p);
        h.update(`${path.relative(root, p)}:${st.size}:${st.mtimeMs}\n`);
      }
    }
  };
  walk(root);
  return h.digest('hex');
}

let roots;
let api;

test.before(async () => {
  roots = makeRoots();
  api = await startApp({ contentRoot: roots.content, agentsRoot: roots.agents });
});
test.after(async () => {
  await api.close();
  rmrf(roots.content, roots.agents);
});

test('status reports both roots in mode B', async () => {
  const { body } = await api.json('/api/status');
  assert.equal(body.content.ok, true);
  assert.equal(body.content.unverified, false);
  assert.equal(body.agents.ok, true);
  assert.equal(body.mode, 'B');
  assert.equal(body.schema.id, 'icor-concepts/1');
});

test('nav, lists and documents', async () => {
  const nav = (await api.json('/api/nav')).body;
  assert.equal(nav.types.find((t) => t.type === 'projects').count, 1);
  assert.equal(nav.agents, true);
  const docs = (await api.json('/api/list/documents')).body;
  assert.deepEqual(docs.items.map((i) => i.title), ['Example Invoice']);
  const unknown = await api.get('/api/list/secrets');
  assert.equal(unknown.status, 404);
});

test('note: known fields, raw fields, backlinks, preview, Obsidian link', async () => {
  const { body } = await api.json(`/api/note?concept=notes&name=${encodeURIComponent('Soil basics')}`);
  assert.equal(body.found, true);
  assert.equal(body.note.metadata.note_type, 'reference');
  assert.equal(body.note.rawFrontmatter.made_up_field, 'hello', 'unknown fields are raw, never schema');
  assert.ok(body.note.outbound.some((o) => o.raw === 'Ada Rivera' && o.clickable));
  assert.ok(body.note.outbound.some((o) => o.raw === 'Missing note' && !o.clickable));
  assert.ok(body.note.uri.startsWith('obsidian://open?vault='));
  const person = (await api.json(`/api/note?name=${encodeURIComponent('Ada Rivera')}`)).body;
  assert.deepEqual(person.note.backlinks.map((b) => b.title), ['Soil basics']);
  const invoice = (await api.json(`/api/note?path=${encodeURIComponent('04 Inner World/Notes/Example Invoice.md')}`)).body;
  assert.equal(invoice.note.preview.kind, 'pdf');
  assert.equal(invoice.note.preview.path, '05 Assets/Documents/invoice-sample.pdf');
  const journal = (await api.json('/api/journal?limit=1')).body;
  assert.equal(journal.entries[0].images[0], '05 Assets/Images/2026/09/garden.png');
  assert.equal(journal.hasMore, true);
});

test('search and graph', async () => {
  const s = (await api.json('/api/search?q=garden')).body;
  assert.ok(s.items.length >= 2);
  const g = (await api.json(`/api/graph?concept=projects&name=${encodeURIComponent('Launch the garden blog')}`)).body;
  assert.equal(g.focus.type, 'projects');
  assert.ok(g.nodes.some((n) => n.type === 'topics'));
});

test('dashboard reads the snapshot and the Planner', async () => {
  const { body } = await api.json('/api/dashboard');
  assert.ok(['ok', 'stale'].includes(body.snapshot.status));
  assert.equal(body.snapshot.data.schema, 1);
  assert.ok(body.planner.week);
});

test('planner board and raw calendar', async () => {
  const b = (await api.json('/api/planner?from=2026-09-28&to=2026-10-04')).body;
  assert.equal(b.columns[0].am[0].title, 'Write the chapter outline');
  const cal = (await api.json('/api/planner/calendar')).body;
  assert.equal(cal.available, true);
  assert.match(cal.body, /Team call/);
});

test('team routes', async () => {
  assert.equal((await api.json('/api/team/agents')).body.agents.length, 2);
  const larry = (await api.json('/api/team/agent/larry')).body;
  assert.equal(larry.agent.stats.sessions, 1);
  assert.equal((await api.json('/api/team/agent/larry/journal')).body.entries.length, 2);
  assert.equal((await api.json('/api/team/session-logs')).body.entries.length, 2);
  assert.equal((await api.json('/api/team/tasks')).body.tasks.length, 3);
  assert.equal((await api.json('/api/team/analytics?from=2026-09-19&to=2026-09-22')).body.totals.sessions, 3);
  const sessions = (await api.json('/api/team/ai-sessions')).body;
  assert.equal(JSON.stringify(sessions).includes('PRIVATE TRANSCRIPT'), false);
  const sops = (await api.json('/api/team/knowledge/sops')).body;
  assert.equal(sops.items[0].docId, 'SOP-1001');
});

test('file routes: allowed previews work, everything else is refused', async () => {
  const ok = await api.get(`/api/file?path=${encodeURIComponent('03 WiP/Projects/2026-09-20-garden-blog/progress-report.md')}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-security-policy'), /default-src 'none'/);
  const pdf = await api.get(`/api/file?path=${encodeURIComponent('01 Inbox/Scanner Inbox/scan-001.pdf')}`);
  assert.equal(pdf.status, 200);
  for (const bad of [
    '../agents/AGENTS.md',
    '04 Inner World/.env',
    '.mcp.json',
    '.icor-for-life/manifest.json',
    '07 Databases/README.md',
    '/etc/passwd',
    '04 Inner World/../../../etc/passwd',
  ]) {
    const r = await api.get(`/api/file?path=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 403, bad);
  }
  const img = await api.get(`/api/asset?path=${encodeURIComponent('05 Assets/Images/2026/09/garden.png')}`);
  assert.equal(img.status, 200);
  const notImg = await api.get(`/api/asset?path=${encodeURIComponent('05 Assets/Documents/invoice-sample.pdf')}`);
  assert.equal(notImg.status, 415);
  const outside = await api.get(`/api/asset?path=${encodeURIComponent('04 Inner World/x.png')}`);
  assert.equal(outside.status, 403);
  const avatar = await api.get(`/api/asset?root=agents&path=${encodeURIComponent('06 AI Team/AI Team Knowledge/Avatars/larry.png')}`);
  assert.equal(avatar.status, 200);
  const transcript = await api.get(`/api/team/file?path=${encodeURIComponent('06 AI Team/AI Sessions/2026-09-20-chat/conversation.md')}`);
  assert.equal(transcript.status, 403, 'q7c: transcripts are never served');
  const env = await api.get(`/api/team/file?path=${encodeURIComponent('06 AI Team/AI Team Knowledge/.env')}`);
  assert.equal(env.status, 403);
});

test('DNS rebinding: a foreign Host header is refused', async () => {
  const http = await import('node:http');
  const port = new URL(api.base).port;
  const status = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/status', headers: { Host: 'evil.example:80' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.end();
  });
  assert.equal(status, 421);
});

test('settings write needs the cockpit header and never lands in a vault', async () => {
  const r = await api.get('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  const cross = await api.get('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cockpit': '1', Origin: 'https://evil.example' },
    body: '{}',
  });
  assert.equal(cross.status, 403);
  for (const m of ['PUT', 'DELETE', 'PATCH']) {
    const w = await api.get('/api/note', { method: m });
    assert.equal(w.status, 404, `${m} has no route`);
  }
});

test('reading everything writes nothing to either root', async () => {
  const before = [treeDigest(roots.content), treeDigest(roots.agents)];
  for (const p of ['/api/status', '/api/dashboard', '/api/list/notes', '/api/journal', '/api/planner',
    '/api/team/analytics', '/api/tree?root=wip', '/api/tree?root=inbox', '/api/search?q=seed']) {
    const r = await api.get(p);
    assert.equal(r.status, 200, p);
  }
  const after = [treeDigest(roots.content), treeDigest(roots.agents)];
  assert.deepEqual(after, before);
});

test('tree hides the WiP archive and dot files', async () => {
  const { body } = await api.json('/api/tree?root=wip');
  const names = JSON.stringify(body);
  assert.equal(names.includes('_archive'), false);
  assert.ok(names.includes('progress-report.md'));
});

test('asset by embed name resolves only inside 05 Assets', async () => {
  const ok = await api.get('/api/asset?path=garden.png');
  assert.equal(ok.status, 200);
  const miss = await api.get('/api/asset?path=nothing.png');
  assert.equal(miss.status, 403);
  const sneaky = await api.get(`/api/asset?path=${encodeURIComponent('../../etc/garden.png')}`);
  assert.equal(sneaky.status, 200, 'a basename lookup never leaves 05 Assets');
});
