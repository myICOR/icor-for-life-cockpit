// settings.js - the Cockpit's own settings file, never inside a vault.
//
// `cockpit.settings.json` lives in the Cockpit folder (gitignored) and holds two
// absolute paths: the ICOR for Life folder (required) and the agents folder
// (optional, same or separate). Environment variables win over the file so a
// launcher or a test can pin both: ICOR_CONTENT_ROOT, ICOR_AGENTS_ROOT, and
// COCKPIT_SETTINGS_FILE to move the file itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const COCKPIT_ROOT = path.resolve(__dirname, '..');

export function settingsFile() {
  return process.env.COCKPIT_SETTINGS_FILE
    ? path.resolve(process.env.COCKPIT_SETTINGS_FILE)
    : path.join(COCKPIT_ROOT, 'cockpit.settings.json');
}

function clean(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** @returns {{ contentRoot: string|null, agentsRoot: string|null, lockedByEnv: { content: boolean, agents: boolean } }} */
export function readSettings() {
  let stored = {};
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    if (raw.length < 64 * 1024) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
    }
  } catch {
    /* no file yet, or unreadable: start empty */
  }
  const envContent = clean(process.env.ICOR_CONTENT_ROOT);
  const envAgents = clean(process.env.ICOR_AGENTS_ROOT);
  return {
    contentRoot: envContent ?? clean(stored.contentRoot),
    agentsRoot: envAgents ?? clean(stored.agentsRoot),
    lockedByEnv: { content: envContent != null, agents: envAgents != null },
  };
}

/**
 * Write the two paths into the Cockpit's own settings file. Only absolute
 * paths are accepted; an empty agents path clears it. This is the Cockpit's
 * only write, and it never lands in either vault.
 */
export function writeSettings({ contentRoot, agentsRoot }) {
  const next = {
    contentRoot: clean(contentRoot),
    agentsRoot: clean(agentsRoot),
  };
  const label = { contentRoot: 'The ICOR for Life folder', agentsRoot: 'The agents folder' };
  for (const [k, v] of Object.entries(next)) {
    if (v != null && v.includes('\0')) throw new Error(`${label[k]} is not a valid path.`);
    if (v != null && !path.isAbsolute(v)) {
      throw new Error(`${label[k]} must be a full path, starting with / (or a drive letter on Windows).`);
    }
  }
  const file = settingsFile();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return next;
}
