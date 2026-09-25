// schema.js - the one reader of the vendored icor-concepts/1 schema.
//
// The file under schema/ is a byte-identical copy of myPKA 6.0.1
// `.mypka/icor-concepts-1.json` (GL-1014). It is pinned by sha256: a copy that
// does not match refuses to load, and `npm test` fails on it too
// (scripts/check-schema-pin.mjs). When an agents root carries its own copy, the
// vendored one still wins: one reader, one version (D2 section 2).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'icor-concepts-1.json');
export const SCHEMA_SHA256 = '278e54515b31ef7738d5a8028475eddc51b696e6ab9a13be4dc6523398889275';
export const SCHEMA_ID = 'icor-concepts/1';

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadSchema() {
  const digest = sha256File(SCHEMA_PATH);
  if (digest !== SCHEMA_SHA256) {
    throw new Error(
      `schema/icor-concepts-1.json does not match its pin (${digest}). ` +
      'Restore the byte-identical copy from myPKA 6.0.1.',
    );
  }
  const data = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  if (data.id !== SCHEMA_ID) throw new Error(`unexpected schema id ${data.id}`);
  return data;
}

export const SCHEMA = loadSchema();

/** A content concept's folder, root-relative (the schema's default_path). */
export function conceptPath(concept) {
  const c = SCHEMA.concepts[concept];
  if (!c) throw new Error(`unknown concept ${concept}`);
  return c.default_path;
}

/** A named slot inside a concept, root-relative. */
export function slotPath(concept, slot) {
  const c = SCHEMA.concepts[concept];
  const s = c?.slots?.[slot];
  if (!s) throw new Error(`unknown slot ${concept}.${slot}`);
  return `${c.default_path}/${s}`;
}

/** A team concept's folder under the agents root (GL-1013 section 2.2). */
export function teamPath(concept) {
  const p = SCHEMA.team_concepts[concept];
  if (typeof p !== 'string') throw new Error(`unknown team concept ${concept}`);
  return p;
}

/** The field names a type declares (for the "known fields" split). */
export function typeFields(type) {
  return Object.keys(SCHEMA.types[type]?.fields ?? {});
}

/** The concept a frontmatter `type` belongs to, or null. */
export function conceptOfType(type) {
  const t = SCHEMA.types[type];
  return t?.concept ?? null;
}
