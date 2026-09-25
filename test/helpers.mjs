// helpers.mjs - copy the fixture folders to a temp dir, plant the files that
// must never be served, and mount the app on an ephemeral loopback port.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(__dirname, 'fixtures');

export function tempCopy(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cockpit-${name}-`));
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return fs.realpathSync(dir);
}

/** Two temp roots: content (ICOR 2.0 shape) and agents (myPKA 6, mode B). */
export function makeRoots() {
  const content = tempCopy('content');
  const agents = tempCopy('agents');
  // Files that exist on real machines and must never be served.
  fs.writeFileSync(path.join(content, '04 Inner World', '.env'), 'EXAMPLE_ONLY=planted\n');
  fs.writeFileSync(path.join(agents, '06 AI Team', 'AI Team Knowledge', '.env'), 'EXAMPLE_ONLY=planted\n');
  fs.writeFileSync(path.join(content, '.mcp.json'), '{}\n');
  return { content, agents };
}

export async function startApp(settings) {
  const store = createStore({
    watch: false,
    settingsReader: () => ({ ...settings, lockedByEnv: { content: false, agents: false } }),
    log: { error() {} },
  });
  store.rebuild();
  const app = createApp(store);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store,
    base,
    get: (p, init) => fetch(`${base}${p}`, init),
    json: async (p) => {
      const r = await fetch(`${base}${p}`);
      return { status: r.status, body: await r.json() };
    },
    close: () => new Promise((resolve) => {
      store.close();
      server.close(resolve);
    }),
  };
}

export function rmrf(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
