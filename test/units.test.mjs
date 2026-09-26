// units.test.mjs - the pure readers: frontmatter, jail, roots, snapshot,
// planner parsing, index and backlinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { splitFrontmatter, findWikilinks } from '../server/frontmatter.js';
import { containedPath } from '../server/jail.js';
import { checkContentRoot, checkAgentsRoot, resolveRoots } from '../server/roots.js';
import { readSnapshot } from '../server/snapshot.js';
import { plannerBoard, parseMarker, isoWeek } from '../server/planner.js';
import { buildContentIndex, resolveTarget, conceptCounts } from '../server/contentIndex.js';
import { buildAgentsIndex } from '../server/agentsIndex.js';
import { teamAnalytics } from '../server/analytics.js';
import { makeRoots, tempCopy, rmrf } from './helpers.mjs';

test('frontmatter: core schema keeps dates as text, broken YAML is marked unparsed', () => {
  const ok = splitFrontmatter('---\ndate: 2026-09-20\nlist: ["[[A]]"]\n---\nbody');
  assert.equal(ok.fm.date, '2026-09-20');
  assert.equal(ok.body, 'body');
  const bad = splitFrontmatter('---\nx: [unclosed\n---\nbody');
  assert.equal(bad.unparsed, true);
  assert.deepEqual(bad.fm, {});
  const custom = splitFrontmatter('---\nx: !!js/function "() => 1"\n---\n');
  assert.equal(typeof custom.fm.x === 'function', false);
});

test('frontmatter: an oversized block is refused', () => {
  const big = `---\nx: "${'a'.repeat(300 * 1024)}"\n---\nbody`;
  assert.equal(splitFrontmatter(big).unparsed, true);
});

test('wikilinks: labels, headings and embeds', () => {
  const links = findWikilinks('See [[Target|Label]], [[Other#Part]] and ![[pic.png|240]].');
  assert.deepEqual(links.map((l) => [l.target, l.embed]), [['Target', false], ['Other', false], ['pic.png', true]]);
});

test('jail: traversal, absolute, dot folders, env files and symlinks are refused', () => {
  const { content, agents } = makeRoots();
  try {
    assert.ok(containedPath(content, '04 Inner World/Notes/Soil basics.md'));
    assert.equal(containedPath(content, '../agents/AGENTS.md'), null);
    assert.equal(containedPath(content, '/etc/passwd'), null);
    assert.equal(containedPath(content, '04 Inner World/.env'), null);
    assert.equal(containedPath(content, '.mcp.json'), null);
    assert.equal(containedPath(content, '.icor-for-life/manifest.json'), null);
    assert.ok(containedPath(content, '.icor-for-life/manifest.json', { allowDot: ['.icor-for-life/manifest.json'] }));
    fs.symlinkSync(path.join(agents, 'AGENTS.md'), path.join(content, '04 Inner World', 'Notes', 'escape.md'));
    assert.equal(containedPath(content, '04 Inner World/Notes/escape.md'), null);
  } finally {
    rmrf(content, agents);
  }
});

test('roots: content verified, unverified without manifest, refused without rooms', () => {
  const { content, agents } = makeRoots();
  try {
    const ok = checkContentRoot(content);
    assert.equal(ok.ok, true);
    assert.equal(ok.unverified, false);
    fs.rmSync(path.join(content, '.icor-for-life', 'manifest.json'));
    assert.equal(checkContentRoot(content).unverified, true);
    assert.equal(checkContentRoot(agents).ok, false);
    assert.equal(checkContentRoot('relative/path').ok, false);
  } finally {
    rmrf(content, agents);
  }
});

test('roots: icor-concepts/2 is refused', () => {
  const content = tempCopy('content');
  try {
    const mf = path.join(content, '.icor-for-life', 'manifest.json');
    fs.writeFileSync(mf, JSON.stringify({ schema: 1, implements: 'icor-concepts/2' }));
    assert.equal(checkContentRoot(content).ok, false);
  } finally {
    rmrf(content);
  }
});

test('roots: mode B for two folders, mode A for one, nested refused', () => {
  const { content, agents } = makeRoots();
  try {
    assert.equal(checkAgentsRoot(agents).ok, true);
    assert.equal(resolveRoots({ contentRoot: content, agentsRoot: agents }).mode, 'B');
    assert.equal(resolveRoots({ contentRoot: content, agentsRoot: null }).mode, null);
    // Mode A: the team installed into the content folder.
    fs.cpSync(agents, content, { recursive: true });
    assert.equal(resolveRoots({ contentRoot: content, agentsRoot: content }).mode, 'A');
    // Nested: an agents folder inside the content folder.
    const nested = path.join(content, '03 WiP', 'team');
    fs.cpSync(agents, nested, { recursive: true });
    const r = resolveRoots({ contentRoot: content, agentsRoot: nested });
    assert.equal(r.mode, null);
    assert.match(r.error, /E_NESTED/);
  } finally {
    rmrf(content, agents);
  }
});

test('snapshot: ok, stale, missing, refused, and path values jailed', () => {
  const content = tempCopy('content');
  try {
    const fresh = readSnapshot(content, new Date('2026-09-28T08:00:00Z'));
    assert.equal(fresh.status, 'ok');
    assert.equal(fresh.snapshot.goals.open[1].path, null, 'an escaping path is dropped');
    assert.equal(fresh.snapshot.goals.open[0].path, '04 Inner World/My Life/Goals/Grow a garden.md');
    assert.equal(readSnapshot(content, new Date('2026-09-29T08:00:00Z')).status, 'stale');
    const file = path.join(content, '.icor-for-life', 'scripts', 'snapshot.json');
    fs.writeFileSync(file, JSON.stringify({ schema: 2 }));
    assert.equal(readSnapshot(content).status, 'refused');
    fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1));
    assert.equal(readSnapshot(content).status, 'refused');
    fs.rmSync(file);
    assert.equal(readSnapshot(content).status, 'missing');
  } finally {
    rmrf(content);
  }
});

test('planner: markers, ISO week, board columns, tray, nesting, week, habits, routines', () => {
  assert.equal(parseMarker('Y').state, 'done');
  assert.equal(parseMarker('\u2013').state, 'missed');
  assert.equal(parseMarker('\u2014').state, 'pending');
  assert.equal(parseMarker('\u2713').state, 'done');
  assert.deepEqual(parseMarker('2/3'), { state: 'partial', done: 2, total: 3 });
  assert.equal(isoWeek(new Date(2026, 8, 28, 12)), '2026-W40');

  const content = tempCopy('content');
  try {
    const b = plannerBoard(content, { from: '2026-09-28', to: '2026-10-04', today: new Date(2026, 8, 28, 12) });
    assert.equal(b.columns.length, 7);
    const mon = b.columns[0];
    assert.equal(mon.day, '2026-09-28');
    assert.deepEqual(mon.am.map((i) => i.title), ['Write the chapter outline']);
    assert.deepEqual(mon.am[0].children.map((i) => i.title), ['Pick a theme'], 'child nests under its parent');
    assert.equal(mon.am[0].linkedNote, 'Launch the garden blog');
    assert.ok(mon.am[0].uri.startsWith('obsidian://open?vault='));
    assert.equal(b.columns[1].pm[0].status, 'done');
    assert.deepEqual(b.tray.map((i) => i.title), ['Buy seeds']);
    assert.equal(b.tray[0].weeklyGoal, true);
    assert.deepEqual(b.week.priorities, [
      { text: 'Draft the first post', done: false },
      { text: 'Order the raised bed', done: true },
    ]);
    assert.equal(b.week.highlights.find((h) => h.date === '2026-09-28').marker.state, 'done');
    assert.equal(b.habitDays['2026-09-28'][0].marker.state, 'done');
    assert.equal(b.habitDays['2026-09-29'][0].marker.state, 'missed');
    assert.equal(b.habitDays['2026-10-03'].length, 0, 'weekdays cadence skips Saturday');
    assert.deepEqual(b.routineDays['2026-09-28'][0].marker, { state: 'partial', done: 2, total: 3 });
    assert.equal(b.routineDays['2026-09-28'][0].steps, 3);
    assert.ok(b.calendar);
  } finally {
    rmrf(content);
  }
});

test('index: concepts, backlinks, full-path links, unparsed notes stay listed', () => {
  const content = tempCopy('content');
  try {
    const idx = buildContentIndex(content);
    const counts = conceptCounts(idx);
    assert.equal(counts.projects, 1);
    assert.equal(counts.notes, 3);
    assert.equal(counts.documents, 1);
    assert.equal(counts.inbox, 2);
    assert.equal(counts.journal, 2);
    // A project is linked from a journal entry, a planner item and a goal? no:
    const project = resolveTarget(idx, 'Launch the garden blog');
    const from = idx.backlinks.get(project.path).map((b) => b.from.concept).sort();
    assert.deepEqual(from, ['journal', 'planner']);
    // Two notes share the name "Morning walk"; the full path picks the planner one.
    const planner = resolveTarget(idx, '02 Planner/Habits/Morning walk');
    assert.equal(planner.concept, 'planner');
    assert.equal(resolveTarget(idx, 'Morning walk').concept, 'habits');
    const broken = idx.byPath.get('04 Inner World/Notes/Broken frontmatter.md');
    assert.equal(broken.unparsed, true);
    // M1: folder README files are room notes, not knowledge.
    assert.equal(idx.notes.some((n) => /readme\.md$/i.test(n.path)), false);
    // WiP bodies and 07 Databases never enter the index.
    assert.equal(idx.notes.some((n) => n.path.startsWith('03 WiP') || n.path.startsWith('07 Databases')), false);
  } finally {
    rmrf(content);
  }
});

test('agents: roster, avatars, insights, v6 and v5 logs, tasks, AI Session metadata only', () => {
  const { content, agents } = makeRoots();
  try {
    const ai = buildAgentsIndex(agents);
    assert.deepEqual(ai.agents.map((a) => a.slug), ['larry', 'penn'], 'M2: the nil-id template is not a specialist');
    assert.equal(ai.agents[0].avatar, '06 AI Team/AI Team Knowledge/Avatars/larry.png');
    assert.equal(ai.insights.length, 2, 'the _template is skipped');
    assert.equal(ai.insights.find((i) => i.topic === 'old').status, 'superseded');
    assert.equal(ai.insights[0].learned, 'Route first.');
    const shapes = ai.sessionLogs.map((l) => l.shape).sort();
    assert.deepEqual(shapes, ['v5', 'v6']);
    assert.deepEqual(ai.sessionLogs.find((l) => l.shape === 'v6').agents, ['larry', 'penn']);
    assert.deepEqual(ai.tasks.map((t) => t.state).sort(), ['done', 'in-progress', 'open']);
    assert.equal(ai.tasks.find((t) => t.state === 'done').month, '2026-09');
    assert.equal(ai.aiSessions[0].title, 'Garden planning chat');
    assert.equal(JSON.stringify(ai.aiSessions).includes('PRIVATE TRANSCRIPT'), false);

    const a = teamAnalytics(ai, { from: '2026-09-19', to: '2026-09-22' });
    assert.equal(a.totals.sessions, 3, 'v6 counts once per agent, v5 once');
    assert.deepEqual(a.agents.map((x) => [x.slug, x.sessions]), [['penn', 2], ['larry', 1]]);
    // H4: the share is shown as a whole percent, computed once, here.
    assert.deepEqual(a.agents.map((x) => x.sharePct), [67, 33]);
    assert.equal(a.totals.meanPerSpecialist, 1.5);
    assert.equal(a.series.length, 4);
    assert.equal(a.series.find((d) => d.day === '2026-09-20').sessions, 2);
    assert.deepEqual(a.tasks.totals, { open: 1, 'in-progress': 1, done: 1, cancelled: 0 });
    assert.equal(a.conversations.total, 1);
  } finally {
    rmrf(content, agents);
  }
});
