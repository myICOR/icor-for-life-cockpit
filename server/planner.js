// planner.js - the read-only Planner board over `02 Planner/` (D2 section 4).
//
// The Planner plugin is the only writer of these notes ("machine-tended"). The
// Cockpit reads items, the week note, habits and routines, and never drags,
// checks or reorders anything: every card links into Obsidian instead. The
// sentinel tables are parsed only under their own sentinel comment, using the
// GL-1002 marker set (Y, N, _, S, n/m).
import fs from 'node:fs';
import path from 'node:path';
import { conceptPath, slotPath } from './schema.js';
import { splitFrontmatter, asText, linkName } from './frontmatter.js';

const DAY_MS = 86400000;
const WEEKDAY_CODES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const wd = (x.getDay() + 6) % 7;
  return new Date(x.getTime() - wd * DAY_MS);
}

/** ISO week label YYYY-Www for a local date. */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function readMd(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return null;
    return { st, ...splitFrontmatter(fs.readFileSync(abs, 'utf8')) };
  } catch {
    return null;
  }
}

function listMd(absDir) {
  try {
    return fs.readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && !e.name.startsWith('.'))
      .map((e) => path.join(absDir, e.name));
  } catch {
    return [];
  }
}

function bool(v) {
  return v === true || v === 'true';
}

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Rows of the first markdown table after a sentinel line. */
export function tableAfterSentinel(body, sentinelRe) {
  const lines = String(body || '').split(/\r?\n/);
  const at = lines.findIndex((l) => sentinelRe.test(l.trim()));
  if (at === -1) return null;
  const rows = [];
  let header = null;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (header) break;
      continue;
    }
    if (!line.startsWith('|')) break;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ''])));
  }
  return { header: header ?? [], rows };
}

/** The checklist right after a sentinel line ("- [ ] text" / "- [x] text"). */
export function checklistAfterSentinel(body, sentinelRe) {
  const lines = String(body || '').split(/\r?\n/);
  const at = lines.findIndex((l) => sentinelRe.test(l.trim()));
  if (at === -1) return null;
  const items = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line.trim())) break;
    const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (m) items.push({ text: m[2].trim(), done: m[1].toLowerCase() === 'x' });
  }
  return items;
}

/**
 * GL-1002 markers: Y, check mark or G done; N, R or U+2013 not done; _, U+2014
 * or blank pending; S skipped (routines); n/m partial (routines).
 */
export function parseMarker(cell) {
  const c = String(cell ?? '').trim();
  if (['Y', 'y', '\u2713', 'G'].includes(c)) return { state: 'done' };
  if (['N', 'n', 'R', '\u2013'].includes(c)) return { state: 'missed' };
  if (c === 'S' || c === 's') return { state: 'skipped' };
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(c);
  if (frac) return { state: 'partial', done: Number(frac[1]), total: Number(frac[2]) };
  return { state: 'pending' };
}

function vaultUri(vaultName, rel) {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(rel)}`;
}

/** Every planner-item note, from each `02 Planner/<Source>/` folder. */
export function readPlannerItems(root) {
  const base = path.join(root, conceptPath('planner'));
  const reserved = new Set(['Habits', 'Routines', 'Weeks'].map((s) => s.toLowerCase()));
  let sources = [];
  try {
    sources = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !reserved.has(e.name.toLowerCase()))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const vaultName = path.basename(root);
  const items = [];
  for (const folder of sources) {
    for (const abs of listMd(path.join(base, folder))) {
      const n = readMd(abs);
      if (!n || n.fm.type !== 'planner-item') continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const fm = n.fm;
      const plannedHalf = asText(fm.planned_half);
      items.push({
        path: rel,
        uri: vaultUri(vaultName, rel),
        folder,
        source: asText(fm.source) ?? folder.toLowerCase(),
        externalId: asText(fm.external_id),
        title: asText(fm.title) ?? path.basename(abs, '.md'),
        status: asText(fm.status) === 'done' ? 'done' : 'open',
        doneLocal: bool(fm.done_local),
        priority: num(fm.priority) ?? 5,
        due: asText(fm.due)?.slice(0, 10) ?? null,
        url: asText(fm.url),
        tags: Array.isArray(fm.tags) ? fm.tags.map(asText).filter(Boolean) : [],
        plannedDay: asText(fm.planned_day)?.slice(0, 10) ?? null,
        plannedHalf: plannedHalf === 'am' || plannedHalf === 'pm' ? plannedHalf : null,
        plannedOrder: num(fm.planned_order),
        weeklyGoal: bool(fm.weekly_goal),
        linkedNote: linkName(fm.linked_note),
        parentId: asText(fm.parent_id),
        recurring: fm.recurring === true ? true : fm.recurring === false ? false : null,
        syncedAt: asText(fm.synced_at),
        doneAt: asText(fm.done_at),
      });
    }
  }
  return items;
}

/** The week note: weekly priorities checklist and the daily highlight table. */
export function readWeek(root, weekLabel) {
  const rel = `${slotPath('planner', 'weeks')}/${weekLabel}.md`;
  const n = readMd(path.join(root, rel));
  if (!n) return { week: weekLabel, path: null, priorities: [], highlights: [] };
  const priorities = checklistAfterSentinel(n.body, /^<!--\s*weekly-priorities:\s*schema=checklist\s*-->$/) ?? [];
  const table = tableAfterSentinel(n.body, /^<!--\s*daily-highlights:\s*schema=highlight\s*-->$/);
  const highlights = (table?.rows ?? [])
    .map((r) => ({ date: (r.date ?? '').slice(0, 10), text: r.highlight ?? '', marker: parseMarker(r.done) }))
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date) && h.text);
  return { week: weekLabel, path: rel, uri: vaultUri(path.basename(root), rel), priorities, highlights };
}

function weekdayCode(d) {
  return WEEKDAY_CODES[(d.getDay() + 6) % 7];
}

function habitRunsOn(h, d) {
  if (h.status !== 'active') return false;
  if (h.startedOn && isoDate(d) < h.startedOn) return false;
  const code = weekdayCode(d);
  switch (h.cadence) {
    case 'daily': return true;
    case 'weekdays': return !['sat', 'sun'].includes(code);
    case 'weekly': return (h.cadenceDays.length ? h.cadenceDays : ['mon']).includes(code);
    case 'monthly': return d.getDate() === (h.monthDay ?? 1);
    default: return false;
  }
}

/** Planner habits with their log rows (read-only). */
export function readHabits(root) {
  const vaultName = path.basename(root);
  const out = [];
  for (const abs of listMd(path.join(root, slotPath('planner', 'habits')))) {
    const n = readMd(abs);
    if (!n || n.fm.type !== 'planner-habit') continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const table = tableAfterSentinel(n.body, /^<!--\s*habit-log:\s*schema=(streak|process)\s*-->$/);
    const log = {};
    for (const row of table?.rows ?? []) {
      const date = (row.date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const cell = row.done ?? row.status ?? Object.values(row)[1];
      log[date] = parseMarker(cell);
    }
    out.push({
      path: rel,
      uri: vaultUri(vaultName, rel),
      name: asText(n.fm.name) ?? path.basename(abs, '.md'),
      cadence: asText(n.fm.cadence),
      cadenceDays: Array.isArray(n.fm.cadence_days) ? n.fm.cadence_days.map((x) => String(x).toLowerCase()) : [],
      monthDay: num(n.fm.month_day),
      status: asText(n.fm.status),
      startedOn: asText(n.fm.started_on)?.slice(0, 10) ?? null,
      linkedNote: linkName(n.fm.linked_note),
      log,
    });
  }
  return out;
}

/** Planner routines with today's step count, when logged. */
export function readRoutines(root) {
  const vaultName = path.basename(root);
  const out = [];
  for (const abs of listMd(path.join(root, slotPath('planner', 'routines')))) {
    const n = readMd(abs);
    if (!n || n.fm.type !== 'planner-routine') continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const steps = [];
    const lines = n.body.split(/\r?\n/);
    const at = lines.findIndex((l) => /^##\s+Steps\s*$/i.test(l.trim()));
    if (at !== -1) {
      for (let i = at + 1; i < lines.length; i += 1) {
        if (/^#{1,6}\s/.test(lines[i].trim())) break;
        const m = /^\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(lines[i]);
        if (m && m[1].trim()) steps.push(m[1].trim());
      }
    }
    const table = tableAfterSentinel(n.body, /^<!--\s*routine-log:\s*schema=steps\s*-->$/);
    const log = {};
    for (const row of table?.rows ?? []) {
      const date = (row.date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const cell = row.done ?? row.steps ?? Object.values(row)[1];
      log[date] = parseMarker(cell);
    }
    out.push({
      path: rel,
      uri: vaultUri(vaultName, rel),
      name: asText(n.fm.name) ?? path.basename(abs, '.md'),
      routineType: asText(n.fm.routine_type),
      start: asText(n.fm.start),
      end: asText(n.fm.end),
      weekdays: Array.isArray(n.fm.weekdays) ? n.fm.weekdays.map((x) => String(x).toLowerCase()) : [],
      active: n.fm.active === true || n.fm.active === 'true',
      steps,
      log,
    });
  }
  return out;
}

/**
 * The board for a date range (default: the current week, Monday to Sunday).
 * Columns are days; a card sits in its `planned_day` column split am / pm,
 * sorted by `planned_order`; undated open items sit in the tray with weekly
 * goals first. Children nest under a parent from the same source only.
 */
export function plannerBoard(root, { from = null, to = null, today = new Date() } = {}) {
  const start = parseIsoDate(from) ?? mondayOf(today);
  let end = parseIsoDate(to) ?? new Date(start.getTime() + 6 * DAY_MS);
  if (end < start) end = new Date(start.getTime() + 6 * DAY_MS);
  if ((end - start) / DAY_MS > 41) end = new Date(start.getTime() + 41 * DAY_MS);
  const days = [];
  for (let t = start.getTime(); t <= end.getTime() + 1000; t += DAY_MS) days.push(isoDate(new Date(t)));

  const all = readPlannerItems(root);
  const bySourceId = new Map(all.map((i) => [`${i.source}::${i.externalId}`, i]));
  const byOrder = (a, b) => (a.plannedOrder ?? 1e12) - (b.plannedOrder ?? 1e12) || a.title.localeCompare(b.title);
  const childrenOf = new Map();
  for (const i of all) {
    if (!i.parentId) continue;
    const parent = bySourceId.get(`${i.source}::${i.parentId}`);
    if (!parent) continue;
    const k = parent.path;
    if (!childrenOf.has(k)) childrenOf.set(k, []);
    childrenOf.get(k).push(i);
  }
  const isChild = (i) => i.parentId && bySourceId.has(`${i.source}::${i.parentId}`);
  const withChildren = (i) => ({ ...i, children: (childrenOf.get(i.path) ?? []).sort(byOrder) });

  const columns = days.map((day) => {
    const inDay = all.filter((i) => i.plannedDay === day && !isChild(i));
    return {
      day,
      am: inDay.filter((i) => i.plannedHalf === 'am').sort(byOrder).map(withChildren),
      pm: inDay.filter((i) => i.plannedHalf === 'pm').sort(byOrder).map(withChildren),
      anytime: inDay.filter((i) => i.plannedHalf == null).sort(byOrder).map(withChildren),
    };
  });
  const tray = all
    .filter((i) => !i.plannedDay && i.status === 'open' && !isChild(i))
    .sort((a, b) => Number(b.weeklyGoal) - Number(a.weeklyGoal) || a.priority - b.priority || byOrder(a, b))
    .map(withChildren);

  const habits = readHabits(root);
  const routines = readRoutines(root);
  const habitDays = Object.fromEntries(days.map((day) => {
    const d = parseIsoDate(day);
    return [day, habits.filter((h) => habitRunsOn(h, d)).map((h) => ({
      name: h.name, path: h.path, uri: h.uri, marker: h.log[day] ?? { state: 'pending' },
    }))];
  }));
  const routineDays = Object.fromEntries(days.map((day) => {
    const code = weekdayCode(parseIsoDate(day));
    return [day, routines.filter((r) => r.active && r.weekdays.includes(code)).map((r) => ({
      name: r.name, path: r.path, uri: r.uri, routineType: r.routineType, start: r.start, end: r.end,
      steps: r.steps.length, marker: r.log[day] ?? { state: 'pending' },
    }))];
  }));

  const calendarAbs = path.join(root, conceptPath('planner'), 'Calendar Events.md');
  let calendar = null;
  try {
    const st = fs.statSync(calendarAbs);
    if (st.isFile()) calendar = { path: `${conceptPath('planner')}/Calendar Events.md`, updated: new Date(st.mtimeMs).toISOString() };
  } catch {
    calendar = null;
  }

  return {
    from: days[0],
    to: days[days.length - 1],
    today: isoDate(today),
    vault: path.basename(root),
    week: readWeek(root, isoWeek(start)),
    columns,
    tray,
    habitDays,
    routineDays,
    calendar,
    counts: {
      items: all.length,
      open: all.filter((i) => i.status === 'open' && !i.doneLocal).length,
      done: all.filter((i) => i.status === 'done' || i.doneLocal).length,
    },
  };
}

/** Calendar Events.md as raw markdown (D2 F2: parsed in v1.1, not now). */
export function readCalendarMarkdown(root) {
  const abs = path.join(root, conceptPath('planner'), 'Calendar Events.md');
  const n = readMd(abs);
  if (!n) return { available: false, body: '', updated: null };
  return { available: true, body: n.body, updated: new Date(n.st.mtimeMs).toISOString() };
}
