// roots.js - decide whether a folder is an ICOR for Life content root and
// whether a second folder is a myPKA agents root (D2 section 2).
//
//   content: `.icor-for-life/manifest.json` with implements "icor-concepts/1"
//            AND the rooms `02 Planner` + `04 Inner World`. Rooms without that
//            manifest line (a pre-2.0 scaffold, or dot folders that did not
//            travel over Obsidian Sync) are accepted with an `unverified` badge.
//            icor-concepts/2, or no rooms: refused.
//   agents:  `AGENTS.md` AND `06 AI Team/Agents/` (GL-1013 section 6 marker).
//   mode:    same folder = A, different = B, one inside the other = refused
//            (GL-1013 E_NESTED).
// The Cockpit never parses `.mypka/sources.yaml`: resolve.py is the only
// resolver, and the Settings screen shows the command that runs it.
import fs from 'node:fs';
import path from 'node:path';
import { isInside } from './jail.js';
import { SCHEMA_ID, teamPath } from './schema.js';

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function realOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** @returns {{ ok: boolean, root?: string, unverified?: boolean, version?: string|null, reason?: string }} */
export function checkContentRoot(dir) {
  if (!dir) return { ok: false, reason: 'No ICOR for Life folder is set yet. Add it in Settings.' };
  if (!path.isAbsolute(dir)) return { ok: false, reason: 'The ICOR for Life folder must be an absolute path.' };
  const root = realOrNull(dir);
  if (!root || !isDir(root)) return { ok: false, reason: `The ICOR for Life folder was not found: ${dir}` };
  const rooms = isDir(path.join(root, '02 Planner')) && isDir(path.join(root, '04 Inner World'));

  let manifest = null;
  const mf = path.join(root, '.icor-for-life', 'manifest.json');
  if (isFile(mf)) {
    try {
      const raw = fs.readFileSync(mf, 'utf8');
      if (raw.length <= 2 * 1024 * 1024) manifest = JSON.parse(raw);
    } catch {
      manifest = null;
    }
  }
  const implementsId = manifest && typeof manifest.implements === 'string' ? manifest.implements : null;
  const version = manifest && typeof manifest.version === 'string' ? manifest.version : null;

  if (implementsId && implementsId !== SCHEMA_ID) {
    return { ok: false, reason: `This folder implements ${implementsId}; this Cockpit reads ${SCHEMA_ID} only.` };
  }
  if (!rooms) {
    return { ok: false, reason: 'This folder has no "02 Planner" and "04 Inner World" rooms, so it is not an ICOR for Life folder.' };
  }
  return { ok: true, root, unverified: implementsId !== SCHEMA_ID, version };
}

/** @returns {{ ok: boolean, root?: string, reason?: string }} */
export function checkAgentsRoot(dir) {
  if (!dir) return { ok: false, reason: 'not-set' };
  if (!path.isAbsolute(dir)) return { ok: false, reason: 'The agents folder must be an absolute path.' };
  const root = realOrNull(dir);
  if (!root || !isDir(root)) return { ok: false, reason: `The agents folder was not found: ${dir}` };
  if (!isFile(path.join(root, 'AGENTS.md')) || !isDir(path.join(root, teamPath('agents')))) {
    return { ok: false, reason: 'This folder has no AGENTS.md and "06 AI Team/Agents", so it is not an AI team folder.' };
  }
  return { ok: true, root };
}

/**
 * Pair the two roots.
 * @returns {{ content: object, agents: object, mode: 'A'|'B'|null, error: string|null }}
 */
export function resolveRoots({ contentRoot, agentsRoot }) {
  const content = checkContentRoot(contentRoot);
  const agentsSet = Boolean(agentsRoot);
  const agents = agentsSet ? checkAgentsRoot(agentsRoot) : { ok: false, reason: 'not-set' };
  let mode = null;
  let error = null;
  if (content.ok && agents.ok) {
    if (content.root === agents.root) mode = 'A';
    else if (isInside(content.root, agents.root) || isInside(agents.root, content.root)) {
      error = 'The agents folder and the ICOR for Life folder are nested, one inside the other. Use the same folder, or two separate ones (E_NESTED).';
    } else mode = 'B';
  }
  return {
    content,
    agents: error ? { ok: false, reason: error } : agents,
    agentsSet,
    mode: error ? null : mode,
    error,
  };
}
