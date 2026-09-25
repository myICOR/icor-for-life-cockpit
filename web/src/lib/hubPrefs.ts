// hubPrefs.ts - which dashboard sections show, and in what order.
//
// A per-browser convenience, so it lives in localStorage (every access wrapped:
// a private window or blocked storage just falls back to the defaults). It is
// never written to either folder and never sent to the server.
import { useCallback, useEffect, useState } from 'react';

export interface HubModule {
  key: string;
  label: string;
  hint: string;
}

export const HUB_MODULES: readonly HubModule[] = [
  { key: 'today', label: 'Today', hint: 'Planner items, habits and routines for today' },
  { key: 'week', label: 'This week', hint: 'Weekly priorities and the daily highlight' },
  { key: 'life', label: 'My life', hint: 'Goals, focus projects, key elements and hot topics' },
  { key: 'buckets', label: 'Buckets', hint: 'Projects, Key Elements, Topics, Goals and Habits' },
  { key: 'latestJournal', label: 'Latest journal', hint: 'Your newest journal entries' },
  { key: 'latestNotes', label: 'Latest notes', hint: 'Notes you changed most recently' },
  { key: 'onThisDay', label: 'On this day', hint: 'This calendar day in months and years past' },
];

const PREFS_SLOT = 'cockpit-hub-prefs-v2';

export interface HubPrefs {
  order: string[];
  hidden: string[];
}

function defaults(): HubPrefs {
  return { order: HUB_MODULES.map((m) => m.key), hidden: [] };
}

function load(): HubPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_SLOT);
    if (!raw) return defaults();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults();
    const p = parsed as Partial<HubPrefs>;
    const known = new Set(HUB_MODULES.map((m) => m.key));
    const order = Array.isArray(p.order) ? p.order.filter((k): k is string => typeof k === 'string' && known.has(k)) : [];
    for (const m of HUB_MODULES) if (!order.includes(m.key)) order.push(m.key);
    const hidden = Array.isArray(p.hidden) ? p.hidden.filter((k): k is string => typeof k === 'string' && known.has(k)) : [];
    return { order, hidden };
  } catch {
    return defaults();
  }
}

function persist(prefs: HubPrefs): void {
  try {
    window.localStorage.setItem(PREFS_SLOT, JSON.stringify(prefs));
  } catch {
    /* storage blocked: the change lasts for this page only */
  }
}

export function useHubPrefs() {
  const [prefs, setPrefs] = useState<HubPrefs>(load);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_SLOT) setPrefs(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback((key: string) => {
    setPrefs((prev) => {
      const hidden = prev.hidden.includes(key) ? prev.hidden.filter((k) => k !== key) : [...prev.hidden, key];
      const next = { ...prev, hidden };
      persist(next);
      return next;
    });
  }, []);

  const move = useCallback((key: string, dir: 'up' | 'down') => {
    setPrefs((prev) => {
      const i = prev.order.indexOf(key);
      const j = dir === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prev.order.length) return prev;
      const order = [...prev.order];
      [order[i], order[j]] = [order[j], order[i]];
      const next = { ...prev, order };
      persist(next);
      return next;
    });
  }, []);

  return { prefs, toggle, move, isOn: (key: string) => !prefs.hidden.includes(key) };
}
