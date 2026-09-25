// server.js - start the ICOR for Life - Cockpit on 127.0.0.1 only.
//
// There is no LAN mode and no PIN: the Cockpit binds loopback, reads the two
// folders set in Settings, and never writes to either. It starts only when you
// start it; nothing here installs a login item or a background agent.
import fs from 'node:fs';
import { createStore } from './store.js';
import { createApp } from './app.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT ?? '4317', 10);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`  PORT="${process.env.PORT}" is not a valid port.`);
  process.exit(1);
}

const store = createStore();
store.rebuild();
const app = createApp(store, { port: PORT });

const server = app.listen(PORT, HOST, () => {
  const s = store.state;
  console.log(`\n  ICOR for Life - Cockpit v${VERSION}`);
  console.log(`  serving:  http://${HOST}:${PORT}  (loopback only, read-only)`);
  if (s.roots?.content.ok) {
    const c = s.content;
    console.log(`  content:  ${s.roots.content.root}${s.roots.content.unverified ? '  (unverified)' : ''}`);
    console.log(`  indexed:  ${c.notes.length} notes in ${c.ms} ms`);
  } else {
    console.log(`  content:  not set. Open the Cockpit and add your ICOR for Life folder in Settings.`);
  }
  if (s.roots?.agents.ok) console.log(`  agents:   ${s.roots.agents.root} (mode ${s.roots.mode})`);
  console.log('  stop:     Ctrl+C\n');
});

server.on('error', (err) => {
  console.error(`  Could not start: ${err.message}`);
  process.exit(1);
});

const stop = () => {
  store.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
