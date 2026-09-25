// check-no-autostart.mjs - prove the install left nothing that starts by itself.
//
// Take a snapshot of every place the operating system starts programs from,
// install and run the Cockpit, take a second snapshot, compare:
//
//   node scripts/check-no-autostart.mjs snapshot before.json
//   ... install, build, make the launcher, start it, stop it ...
//   node scripts/check-no-autostart.mjs compare before.json
//
// READ ONLY. It lists folders and asks the system for lists; it never adds,
// removes or changes an entry. `--login-items` also reads the macOS login
// items through System Events, which may show a one-time permission dialog,
// so it is opt-in.
//
// Verdict: FAIL (exit 1) when an entry appeared whose name or content
// mentions the Cockpit, ICOR, myPKA or node. Any other new entry is listed
// as "changed, not ours" for a human to look at: a machine adds and drops
// its own agents all day, and calling those ours would train people to
// ignore the check.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OURS_RE = /cockpit|icor|mypka|\bnode\b|server\/server\.js/i;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
  } catch {
    return null;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n !== '.DS_Store').map((n) => {
      const p = path.join(dir, n);
      let content = '';
      try {
        if (fs.statSync(p).isFile() && fs.statSync(p).size < 256 * 1024) content = fs.readFileSync(p, 'utf8');
      } catch { /* unreadable: the name still counts */ }
      return { id: `file:${p}`, ours: OURS_RE.test(n) || OURS_RE.test(content) };
    });
  } catch {
    return [];
  }
}

function lines(text, prefix) {
  if (!text) return [];
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ id: `${prefix}:${l}`, ours: OURS_RE.test(l) }));
}

export function snapshot({ loginItems = false } = {}) {
  const home = os.homedir();
  const entries = [];
  if (process.platform === 'darwin') {
    for (const d of [
      path.join(home, 'Library/LaunchAgents'),
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
      '/Library/StartupItems',
    ]) entries.push(...listDir(d));
    // Labels only: the PID and status columns change on their own.
    const lc = run('launchctl', ['list']);
    if (lc) entries.push(...lines(lc.split('\n').slice(1).map((l) => l.split('\t')[2] ?? '').join('\n'), 'launchctl'));
    if (loginItems) {
      const li = run('osascript', ['-e', 'tell application "System Events" to get the name of every login item']);
      if (li) entries.push(...lines(li.split(', ').join('\n'), 'login-item'));
    }
  } else if (process.platform === 'win32') {
    entries.push(...listDir(path.join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs/Startup')));
    entries.push(...lines(run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run']), 'run-key'));
    entries.push(...lines(run('schtasks', ['/query', '/fo', 'csv', '/nh']), 'task'));
  } else {
    entries.push(...listDir(path.join(home, '.config/autostart')));
    entries.push(...listDir(path.join(home, '.config/systemd/user')));
    entries.push(...lines(run('systemctl', ['--user', 'list-unit-files', '--no-legend']), 'systemd-user'));
  }
  if (process.platform !== 'win32') {
    entries.push(...lines((run('crontab', ['-l']) ?? '').split('\n').filter((l) => !l.startsWith('#')).join('\n'), 'cron'));
  }
  return { platform: process.platform, takenAt: new Date().toISOString(), loginItems, entries };
}

export function compare(before, after) {
  const was = new Set(before.entries.map((e) => e.id));
  const added = after.entries.filter((e) => !was.has(e.id));
  return { ours: added.filter((e) => e.ours), other: added.filter((e) => !e.ours) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const loginItems = rest.includes('--login-items') || process.argv.includes('--login-items');
  if (cmd === 'snapshot' && file) {
    fs.writeFileSync(file, JSON.stringify(snapshot({ loginItems }), null, 2));
    console.log(`  Snapshot of autostart places written: ${file}`);
  } else if (cmd === 'compare' && file) {
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { ours, other } = compare(before, snapshot({ loginItems: before.loginItems }));
    for (const e of other) console.log(`  changed, not ours: ${e.id}`);
    if (ours.length) {
      for (const e of ours) console.error(`  NEW AUTOSTART ENTRY: ${e.id}`);
      console.error('  FAIL: the install left something that starts by itself.');
      process.exit(1);
    }
    console.log('  PASS: no new launch agent, login item, startup entry or scheduled job from the Cockpit.');
  } else if (cmd) {
    console.error('  Usage: node scripts/check-no-autostart.mjs snapshot|compare <file> [--login-items]');
    process.exit(1);
  }
}
