// snapshot.js - the Cockpit as a reader of `.icor-for-life/scripts/snapshot.json`.
//
// Implements the five reader lines in ICOR `Scripts/README.md` "Readers of
// snapshot.json":
//   1. refuse over 2 MB, or anything that is not an object with "schema": 1;
//   2. every string is untrusted display text (React renders it as text);
//   3. a `path` / `note` value is kept only when relative, free of "..", and
//      inside the root; otherwise it is dropped to null and shown as text;
//   4. staleness: a stale or unparsable `generated_at` is reported as stale,
//      an absent file means "the script did not run", never "no goals";
//   5. nothing here reaches a model; the Cockpit renders, it does not prompt.
// The Cockpit never runs life-snapshot.py.
import fs from 'node:fs';
import path from 'node:path';
import { conceptPath } from './schema.js';
import { containedPath } from './jail.js';

export const SNAPSHOT_REL = `${conceptPath('life_state')}/snapshot.json`;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_STALE_HOURS = 6;

function sanitizePaths(value, root) {
  if (Array.isArray(value)) return value.map((v) => sanitizePaths(v, root));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'path' || k === 'note') && typeof v === 'string') {
        out[k] = containedPath(root, v, { mustExist: false }) ? v : null;
      } else {
        out[k] = sanitizePaths(v, root);
      }
    }
    return out;
  }
  return value;
}

/**
 * @returns {{ status: 'ok'|'stale'|'missing'|'refused', reason?: string, snapshot?: object, ageHours?: number|null }}
 */
export function readSnapshot(root, now = new Date()) {
  const abs = path.join(root, SNAPSHOT_REL);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return { status: 'missing', reason: 'snapshot not generated' };
  }
  if (!st.isFile()) return { status: 'missing', reason: 'snapshot not generated' };
  if (st.size > MAX_BYTES) return { status: 'refused', reason: 'snapshot.json is larger than 2 MB' };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return { status: 'refused', reason: 'snapshot.json is not valid JSON' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schema !== 1) {
    return { status: 'refused', reason: 'snapshot.json is not schema 1' };
  }
  const snapshot = sanitizePaths(data, root);
  const generated = typeof data.generated_at === 'string' ? Date.parse(data.generated_at) : NaN;
  const hours = Number(data?.thresholds?.stale_after_hours);
  const limit = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_STALE_HOURS;
  if (!Number.isFinite(generated)) return { status: 'stale', reason: 'generated_at is missing or unparsable', snapshot, ageHours: null };
  const ageHours = (now.getTime() - generated) / 3600000;
  if (ageHours > limit || ageHours < -1) return { status: 'stale', reason: `older than ${limit} hours`, snapshot, ageHours };
  return { status: 'ok', snapshot, ageHours };
}
