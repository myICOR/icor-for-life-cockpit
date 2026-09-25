// graph.js - a note's two-hop neighbourhood for the mini-graph, computed from
// the in-memory link index. Node id = `${concept}/${name}`, the same id shape
// the web's MiniGraph has always used.
import { resolveTarget, CONCEPT_SINGLE } from './contentIndex.js';

function nodeId(n) {
  return `${n.concept}/${n.name}`;
}

function neighbours(index, note) {
  const out = new Map();
  for (const l of note.links) {
    if (l.embed) continue;
    const t = resolveTarget(index, l.target);
    if (t && t !== note && !out.has(t.path)) out.set(t.path, { note: t, direction: 'out' });
  }
  for (const b of index.backlinks.get(note.path) ?? []) {
    if (!out.has(b.from.path)) out.set(b.from.path, { note: b.from, direction: 'back' });
  }
  return [...out.values()];
}

const DEGREE = new WeakMap();

function degree(index, note) {
  const hit = DEGREE.get(note);
  if (hit) return hit;
  const outDeg = new Set();
  for (const l of note.links) {
    if (l.embed) continue;
    const t = resolveTarget(index, l.target);
    if (t && t !== note) outDeg.add(t.path);
  }
  const inDeg = (index.backlinks.get(note.path) ?? []).length;
  const d = { inDegree: inDeg, outDegree: outDeg.size, degree: inDeg + outDeg.size };
  DEGREE.set(note, d);
  return d;
}

function toNode(index, n, gen) {
  const d = degree(index, n);
  return {
    id: nodeId(n),
    type: n.concept,
    typeLabel: CONCEPT_SINGLE[n.concept] ?? n.concept,
    slug: n.name,
    title: n.title,
    subtitle: n.type,
    tags: [],
    gen,
    ...d,
    clickable: n.concept !== 'planner',
  };
}

export function neighbourhood(index, focus, { depth = 2, cap = 12 } = {}) {
  const nodes = new Map();
  const edges = new Map();
  const capped = {};
  nodes.set(focus.path, toNode(index, focus, 0));

  const byDegree = (a, b) => degree(index, b.note).degree - degree(index, a.note).degree;
  const first = neighbours(index, focus).sort(byDegree).slice(0, 40);
  for (const { note, direction } of first) {
    nodes.set(note.path, toNode(index, note, 1));
    const src = direction === 'out' ? nodeId(focus) : nodeId(note);
    const dst = direction === 'out' ? nodeId(note) : nodeId(focus);
    edges.set(`${src}->${dst}`, { id: `${src}->${dst}:wikilink`, source: src, target: dst, direction, linkType: 'wikilink' });
  }
  if (depth === 2) {
    for (const { note: hub } of first) {
      const second = neighbours(index, hub).filter((x) => x.note !== focus).sort(byDegree);
      const shown = second.slice(0, cap);
      if (second.length > cap) capped[nodeId(hub)] = second.length - cap;
      for (const { note, direction } of shown) {
        if (!nodes.has(note.path)) nodes.set(note.path, toNode(index, note, 2));
        const src = direction === 'out' ? nodeId(hub) : nodeId(note);
        const dst = direction === 'out' ? nodeId(note) : nodeId(hub);
        if (!edges.has(`${src}->${dst}`)) {
          edges.set(`${src}->${dst}`, { id: `${src}->${dst}:wikilink`, source: src, target: dst, direction, linkType: 'wikilink' });
        }
      }
    }
  }
  const list = [...nodes.values()];
  return {
    focus: { id: nodeId(focus), type: focus.concept, slug: focus.name, title: focus.title, typeLabel: CONCEPT_SINGLE[focus.concept] },
    nodes: list,
    edges: [...edges.values()],
    stats: {
      gen1: list.filter((n) => n.gen === 1).length,
      gen2: list.filter((n) => n.gen === 2).length,
      capped,
      dangling: 0,
    },
  };
}
