// analytics.js - team analytics, all deterministic (GL-075: code, not model).
// Formulas are the D2 contract section 5 table, one function each.
const DAY_MS = 86400000;

function isoDay(t) {
  return new Date(t).toISOString().slice(0, 10);
}

function inRange(day, from, to) {
  return day && (!from || day >= from) && (!to || day <= to);
}

/** Every day from..to inclusive (UTC calendar days), capped at 3 years. */
function dayList(from, to) {
  const out = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(end)) return out;
  while (t <= end && out.length < 1100) {
    out.push(isoDay(t));
    t += DAY_MS;
  }
  return out;
}

function validDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Sessions per agent + a gap-filled daily series (the 1.6.0 teamAnalytics
 * shape, so TeamAnalyticsView is reused as is), plus task flow, insights and
 * conversations. A v6 log counts once per entry of `agents`; a v5 log once
 * for its `agent_id`.
 */
export function teamAnalytics(ai, { from, to } = {}) {
  const logs = ai.sessionLogs;
  const allDays = logs.map((l) => l.day).filter(Boolean).sort();
  const bounds = { from: allDays[0] ?? null, to: allDays[allDays.length - 1] ?? null, total: logs.length };
  const f = validDay(from) ?? bounds.from ?? isoDay(Date.now());
  const t = validDay(to) ?? isoDay(Date.now());

  const byAgent = new Map();
  const perDay = new Map();
  let sessions = 0;
  for (const l of logs) {
    if (!inRange(l.day, f, t)) continue;
    for (const a of l.agents) {
      sessions += 1;
      perDay.set(l.day, (perDay.get(l.day) ?? 0) + 1);
      const row = byAgent.get(a) ?? { slug: a, sessions: 0, firstDay: l.day, lastDay: l.day };
      row.sessions += 1;
      if (l.day < row.firstDay) row.firstDay = l.day;
      if (l.day > row.lastDay) row.lastDay = l.day;
      byAgent.set(a, row);
    }
  }
  const agentMeta = new Map(ai.agents.map((a) => [a.slug, a]));
  const agents = [...byAgent.values()]
    .map((r) => {
      const meta = agentMeta.get(r.slug);
      return {
        ...r,
        name: meta?.name ?? r.slug,
        role: meta?.role ?? null,
        avatarPath: meta?.avatar ?? null,
        share: sessions ? r.sessions / sessions : 0,
        // What the screen shows: a whole percent, rounded once, here (D6 H4).
        sharePct: sessions ? Math.round((r.sessions / sessions) * 100) : 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  const days = dayList(f, t);
  const series = days.map((day) => ({ day, sessions: perDay.get(day) ?? 0 }));

  return {
    range: { from: f, to: t },
    bounds,
    totals: {
      sessions,
      specialists: agents.length,
      days: days.length,
      meanPerSpecialist: agents.length ? Math.round((sessions / agents.length) * 10) / 10 : 0,
    },
    agents,
    series,
    tasks: taskFlow(ai),
    insights: insightCounts(ai),
    conversations: conversationCounts(ai, f, t),
  };
}

/** Open, in-progress, done and cancelled per assignee; done per month. */
export function taskFlow(ai) {
  const byAssignee = new Map();
  const doneByMonth = new Map();
  const totals = { open: 0, 'in-progress': 0, done: 0, cancelled: 0 };
  for (const task of ai.tasks) {
    totals[task.state] += 1;
    const key = task.assignee ?? 'unassigned';
    const row = byAssignee.get(key) ?? { assignee: key, open: 0, 'in-progress': 0, done: 0, cancelled: 0 };
    row[task.state] += 1;
    byAssignee.set(key, row);
    if (task.state === 'done' && task.month) doneByMonth.set(task.month, (doneByMonth.get(task.month) ?? 0) + 1);
  }
  return {
    totals,
    byAssignee: [...byAssignee.values()].sort((a, b) => a.assignee.localeCompare(b.assignee)),
    doneByMonth: [...doneByMonth.entries()].sort().map(([month, done]) => ({ month, done })),
  };
}

/** Journal entries per agent per month, durable vs superseded. */
export function insightCounts(ai) {
  const map = new Map();
  for (const i of ai.insights) {
    const month = String(i.created ?? '').slice(0, 7) || 'undated';
    const k = `${i.agent}::${month}`;
    const row = map.get(k) ?? { agent: i.agent, month, durable: 0, superseded: 0 };
    row[i.status] += 1;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month) || a.agent.localeCompare(b.agent));
}

/** AI Sessions per day and per source. */
export function conversationCounts(ai, from, to) {
  const perDay = new Map();
  const perSource = new Map();
  for (const s of ai.aiSessions) {
    if (!inRange(s.date, from, to)) continue;
    perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1);
    const src = s.source ?? 'unknown';
    perSource.set(src, (perSource.get(src) ?? 0) + 1);
  }
  return {
    total: [...perDay.values()].reduce((a, b) => a + b, 0),
    perDay: [...perDay.entries()].sort().map(([day, count]) => ({ day, count })),
    perSource: [...perSource.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count })),
  };
}
