// store.js - holds the two roots and their in-memory indexes, and keeps them
// fresh with a file watcher (1 s debounce). Reading is all it does: the
// watcher only listens, and a rebuild only reads.
import fs from 'node:fs';
import path from 'node:path';
import { readSettings } from './settings.js';
import { resolveRoots } from './roots.js';
import { buildContentIndex } from './contentIndex.js';
import { buildAgentsIndex } from './agentsIndex.js';

const DEBOUNCE_MS = 1000;
const POLL_MS = 30000;

function relevant(filename) {
  if (!filename) return true;
  const f = String(filename).split(path.sep).join('/');
  if (f === '.icor-for-life/scripts/snapshot.json') return true;
  // Databases never feed the index; a busy SQLite file must not trigger rescans.
  if (f === '07 Databases' || f.startsWith('07 Databases/')) return false;
  return !f.split('/').some((seg) => seg.startsWith('.'));
}

export function createStore({ settingsReader = readSettings, watch = true, log = console } = {}) {
  const state = {
    settings: null,
    roots: null,
    content: null,
    agents: null,
    scannedAt: null,
    scanMs: 0,
    error: null,
  };
  let watchers = [];
  let pollTimer = null;
  let debounce = null;

  function stopWatching() {
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
    watchers = [];
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function schedule() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      rebuild({ rewatch: false });
    }, DEBOUNCE_MS);
    debounce.unref?.();
  }

  function startWatching() {
    stopWatching();
    if (!watch) return;
    const dirs = new Set();
    if (state.roots?.content.ok) dirs.add(state.roots.content.root);
    if (state.roots?.agents.ok) dirs.add(state.roots.agents.root);
    let pollNeeded = false;
    for (const dir of dirs) {
      try {
        const w = fs.watch(dir, { recursive: true, persistent: false }, (_event, filename) => {
          if (relevant(filename)) schedule();
        });
        w.on('error', () => {
          /* a vanished folder: the poll below, or the next settings change, recovers */
        });
        watchers.push(w);
      } catch {
        pollNeeded = true;
      }
    }
    if (pollNeeded && dirs.size) {
      pollTimer = setInterval(() => rebuild({ rewatch: false }), POLL_MS);
      pollTimer.unref?.();
    }
  }

  function rebuild({ rewatch = true } = {}) {
    const started = Date.now();
    try {
      state.settings = settingsReader();
      state.roots = resolveRoots(state.settings);
      state.content = state.roots.content.ok ? buildContentIndex(state.roots.content.root) : null;
      state.agents = state.roots.agents.ok ? buildAgentsIndex(state.roots.agents.root) : null;
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      log.error?.(`  index: ${state.error}`);
    }
    state.scannedAt = new Date().toISOString();
    state.scanMs = Date.now() - started;
    if (rewatch) startWatching();
    return state;
  }

  return {
    state,
    rebuild,
    close() {
      stopWatching();
      if (debounce) clearTimeout(debounce);
    },
  };
}
