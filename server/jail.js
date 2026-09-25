// jail.js - path containment for every file the Cockpit reads or serves.
//
// The rule (D2 contract section 8): every `path=` is resolved against the right
// root with path.relative() containment, never a string prefix (a sibling like
// "04 Inner World-old/" would fool startsWith). Symlinks are resolved with
// realpath BEFORE the check, so a link planted inside the vault cannot point
// the Cockpit at a file outside it.
import fs from 'node:fs';
import path from 'node:path';

/** True when `child` is `parent` itself or lies below it. Both absolute. */
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Names the Cockpit never reads or serves, anywhere (section 8). */
const DENY_NAMES = [/^\.env/i, /^\.mcp\.json$/i];

export function isDeniedName(name) {
  return DENY_NAMES.some((re) => re.test(name));
}

/**
 * Resolve a root-relative path inside `root`, following symlinks, and return
 * the real absolute path, or null when the input is empty, absolute, carries a
 * NUL byte, escapes the root, touches a dot segment, or names a denied file.
 * `allowDot` lists the exact root-relative dot paths that may be read
 * (for example ".icor-for-life/scripts/snapshot.json").
 */
export function containedPath(root, rel, { allowDot = [], mustExist = true } = {}) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return null;
  const norm = rel.replace(/\\/g, '/');
  if (path.isAbsolute(norm) || /^[a-zA-Z]:/.test(norm)) return null;
  const segments = norm.split('/');
  if (segments.some((s) => s === '..')) return null;
  const dotted = segments.some((s) => s.startsWith('.'));
  if (dotted && !allowDot.includes(norm)) return null;
  if (isDeniedName(segments[segments.length - 1])) return null;

  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }
  const abs = path.resolve(realRoot, norm);
  if (!isInside(realRoot, abs) || abs === realRoot) return null;
  if (!mustExist) return abs;
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return null;
  }
  if (!isInside(realRoot, real)) return null;
  return real;
}

/** Forward-slash, root-relative form of an absolute path under `root`. */
export function toRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function realpathNative(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/**
 * The path a route may serve: every rule runs on the REAL file, never on the
 * typed string (D5 M1, M2). Empty segments are refused outright ("a//b"), the
 * file is contained and resolved through symlinks, and then the room, dot and
 * deny rules are checked on its on-disk, case-true path relative to the root,
 * case-insensitively (APFS and NTFS fold case). Returns the real absolute path
 * or null.
 */
export function servedPath(root, rel, { rooms = null, denyPrefixes = [], allowDot = [] } = {}) {
  if (typeof rel !== 'string' || rel.split(/[\\/]/).some((s) => s === '' || s === '.')) return null;
  const contained = containedPath(root, rel, { allowDot });
  if (!contained) return null;
  const realRoot = realpathNative(root);
  const real = realpathNative(contained);
  if (!realRoot || !real || !isInside(realRoot, real) || real === realRoot) return null;
  const realRel = toRel(realRoot, real);
  const segs = realRel.split('/');
  if (segs.some((s) => s.startsWith('.')) && !allowDot.includes(realRel)) return null;
  if (isDeniedName(segs[segs.length - 1])) return null;
  const low = realRel.toLowerCase();
  if (rooms && !rooms.some((r) => segs[0].toLowerCase() === r.toLowerCase())) return null;
  const denied = denyPrefixes.some((p) => {
    const lp = p.toLowerCase();
    return low === lp.replace(/\/$/, '') || low.startsWith(lp);
  });
  if (denied) return null;
  return real;
}
