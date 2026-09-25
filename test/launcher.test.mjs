// launcher.test.mjs - the install starts nothing by itself.
//
// The 2026-09-08 lesson: an earlier desktop wrapper of this Cockpit installed
// a launchd agent, and the app came back on its own after every login. These
// tests hold the line in code instead of in a README sentence:
//   1. no shipped code or dependency can register anything that autostarts,
//   2. the launcher generator refuses every autostart folder,
//   3. the launcher is the readable template with three values filled in,
//   4. the Node check fails loudly on a too-old Node,
//   5. a generated launcher really starts the Cockpit in the foreground and
//      stops with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AUTOSTART_SEGMENTS, autostartReason, buildLauncher, checkCockpitDir, render, writeLauncher,
} from '../scripts/make-launcher.mjs';
import { compare } from '../scripts/check-no-autostart.mjs';
import { tempCopy } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Anything that registers a program to start on its own, on any OS. */
const AUTOSTART_RE =
  /launchctl|LaunchAgents|LaunchDaemons|SMAppService|LSSharedFileList|login ?item|schtasks|reg(\.exe)?\s+add|CurrentVersion\\+Run|systemctl|crontab|\.plist\b|\bpm2\b|nohup|setsid|disown/i;

function codeFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'fixtures'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) codeFiles(p, out);
    else if (/\.(m?js|cjs|ts|tsx|json|template|ya?ml|sh|cmd)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Executable lines only: comments are allowed to explain what we never do. */
function codeLines(text) {
  return text.split('\n').filter((l) => {
    const t = l.trim();
    return t && !/^(#|rem\b|\/\/|\*|\/\*)/i.test(t);
  });
}

test('no shipped code can register an autostart entry', () => {
  const exempt = new Set([
    path.join(ROOT, 'scripts/make-launcher.mjs'), // names the folders it REFUSES
    path.join(ROOT, 'scripts/check-no-autostart.mjs'), // READS them, checked below
    path.join(ROOT, 'test/launcher.test.mjs'),
  ]);
  const files = codeFiles(ROOT).filter((f) => !exempt.has(f) && !f.endsWith('package-lock.json'));
  assert.ok(files.length > 20, `vacuity guard: only ${files.length} files scanned`);
  const hits = [];
  for (const f of files) {
    for (const l of codeLines(fs.readFileSync(f, 'utf8'))) {
      if (AUTOSTART_RE.test(l)) hits.push(`${path.relative(ROOT, f)}: ${l.trim()}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('the autostart checker only ever READS the system lists', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/check-no-autostart.mjs'), 'utf8');
  const calls = [...src.matchAll(/run\('([\w.]+)',\s*\[([^\]]*)\]/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(calls.length >= 6, 'vacuity guard: the checker calls were not found');
  const readOnly = [/^launchctl 'list'$/, /^osascript .*get the name of every login item/, /^reg 'query'/,
    /^schtasks '\/query'/, /^systemctl '--user', 'list-unit-files'/, /^crontab '-l'$/];
  for (const c of calls) assert.ok(readOnly.some((r) => r.test(c)), `not a read-only call: ${c}`);
  assert.doesNotMatch(src, /writeFileSync\([^)]*(LaunchAgents|autostart|Startup)/);
});

test('no dependency is an autostart or process-manager package', () => {
  const banned = /^(node_modules\/)?(auto-launch|node-auto-launch|pm2|forever|node-windows|node-mac|node-linux|launchd.*)$/;
  for (const lock of ['package-lock.json', 'web/package-lock.json']) {
    const pkgs = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, lock), 'utf8')).packages);
    assert.deepEqual(pkgs.filter((p) => banned.test(p.replace(/^.*node_modules\//, ''))), [], lock);
  }
});

test('the generator refuses every autostart folder', () => {
  const home = os.homedir();
  for (const dir of [
    path.join(home, 'Library/LaunchAgents'),
    '/Library/LaunchDaemons/sub',
    path.join(home, '.config/autostart'),
    path.join(home, '.config/systemd/user'),
    'C:/Users/me/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup',
  ]) {
    assert.ok(autostartReason(dir), `not refused: ${dir}`);
    assert.throws(() => writeLauncher({ outDir: dir }), /Refusing to write a launcher/);
  }
  assert.equal(autostartReason(path.join(home, 'Desktop')), null);
  assert.ok(AUTOSTART_SEGMENTS.includes('launchagents'));
});

test('the generator refuses a Cockpit path a launcher cannot quote safely', () => {
  for (const bad of ['/tmp/a"b', '/tmp/$HOME', '/tmp/a`b`', '/tmp/100%', '/tmp/a\nb', '/tmp/R&D', '/tmp/a|b', '/tmp/a<b', '/tmp/a>b', '/tmp/a^b']) {
    assert.throws(() => checkCockpitDir(bad), /cannot carry safely/, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => checkCockpitDir('/Users/ana/Apps/icor-for-life-cockpit'));
});

test('a launcher is the template with exactly three values filled in', () => {
  assert.throws(() => render('a {{MISSING}} b', {}), /has no value/);
  for (const platform of ['mac', 'linux', 'windows']) {
    const { text, file } = buildLauncher({ platform, port: 4999 });
    assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/, `${platform}: placeholder left`);
    assert.ok(text.includes('4999'), `${platform}: port missing`);
    assert.ok(text.includes('2.0.0'), `${platform}: version missing`);
    assert.ok(file.length > 0);
    for (const l of codeLines(text)) assert.doesNotMatch(l, AUTOSTART_RE, `${platform}: ${l}`);
  }
  const mac = buildLauncher({ platform: 'mac', port: 4999 }).text;
  assert.ok(mac.includes(`COCKPIT_DIR="${ROOT}"`));
  assert.match(mac, /exec node server\/server\.js/, 'the Cockpit runs in the foreground of this window');
  const sh = spawnSync('sh', ['-n'], { input: mac });
  assert.equal(sh.status, 0, `sh cannot parse the launcher: ${sh.stderr}`);
  assert.match(buildLauncher({ platform: 'windows' }).text, /\r\n/, 'cmd files need CRLF');
});

test('writing the launcher twice gives one executable file (safe to re-run)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-launcher-'));
  const a = writeLauncher({ outDir: dir, platform: 'mac', port: 4318 });
  const b = writeLauncher({ outDir: dir, platform: 'mac', port: 4318 });
  assert.equal(a, b);
  assert.deepEqual(fs.readdirSync(dir), [path.basename(a)]);
  assert.ok(fs.statSync(a).mode & 0o100, 'launcher must be executable');
});

test('check-node passes here and fails loudly on a too-old Node', () => {
  const ok = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-node.cjs')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  // Red case: the same script against a package.json that demands Node 999.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-node-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts/check-node.cjs'), path.join(dir, 'scripts/check-node.cjs'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=999' } }));
  const old = spawnSync(process.execPath, [path.join(dir, 'scripts/check-node.cjs')], { encoding: 'utf8' });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /needs Node\.js 999 or newer/);
});

test('the autostart compare flags only entries that are ours', () => {
  const before = { entries: [{ id: 'launchctl:com.apple.x', ours: false }] };
  const after = { entries: [
    { id: 'launchctl:com.apple.x', ours: false },
    { id: 'launchctl:com.apple.y', ours: false },
    { id: 'file:/Users/a/Library/LaunchAgents/com.icor.cockpit.plist', ours: true },
  ] };
  const r = compare(before, after);
  assert.deepEqual(r.ours.map((e) => e.id), ['file:/Users/a/Library/LaunchAgents/com.icor.cockpit.plist']);
  assert.deepEqual(r.other.map((e) => e.id), ['launchctl:com.apple.y']);
});

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

test('a generated launcher starts the Cockpit in the foreground, and it stops with it', {
  skip: process.platform === 'win32' || !fs.existsSync(path.join(ROOT, 'web/dist/index.html'))
    ? 'needs a POSIX shell and a built web app' : false,
}, async () => {
  const port = await freePort();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-run-'));
  const launcher = writeLauncher({ outDir: out, platform: 'linux', port });
  const content = tempCopy('content');
  const child = spawn('sh', [launcher], {
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
      COCKPIT_NO_BROWSER: '1',
      ICOR_CONTENT_ROOT: content,
      COCKPIT_SETTINGS_FILE: path.join(out, 'settings.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so the finally block can stop everything the
    // launcher started. A launcher that backgrounded the server would
    // otherwise leave it running and hold this test open.
    detached: true,
  });
  const stopAll = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } };
  try {
    let log = '';
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no start within 15 s:\n${log}`)), 15000);
      const on = (d) => {
        log += d;
        if (log.includes('serving:')) { clearTimeout(t); resolve(); }
      };
      child.stdout.on('data', on);
      child.stderr.on('data', on);
      child.on('exit', (c) => { clearTimeout(t); reject(new Error(`exited ${c}:\n${log}`)); });
    });
    assert.match(log, new RegExp(`http://127\\.0\\.0\\.1:${port}`));
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
  } finally {
    stopAll();
  }
  const code = await new Promise((r) => {
    if (child.exitCode !== null || child.signalCode !== null) return r(child.exitCode ?? child.signalCode);
    const t = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } r('timeout'); }, 5000);
    child.on('exit', (c, sig) => { clearTimeout(t); r(c ?? sig); });
  });
  assert.ok(code === 0 || code === 'SIGTERM', `stop code ${code}`);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`), 'nothing may keep serving after the window closes');
});
