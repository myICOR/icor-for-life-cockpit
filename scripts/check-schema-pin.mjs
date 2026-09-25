// check-schema-pin.mjs - fail when schema/icor-concepts-1.json is not the
// byte-identical myPKA 6.0.1 copy the server is pinned to.
import { sha256File, SCHEMA_PATH, SCHEMA_SHA256 } from '../server/schema.js';

const digest = sha256File(SCHEMA_PATH);
if (digest !== SCHEMA_SHA256) {
  console.error(`schema pin mismatch: ${digest} != ${SCHEMA_SHA256}`);
  process.exit(1);
}
console.log(`schema pin ok (icor-concepts/1, sha256 ${digest.slice(0, 12)})`);
