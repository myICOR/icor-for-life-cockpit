// make-launcher.mjs - write a double-click launcher for the Cockpit.
//
// The launcher is rendered from a readable template in launcher/, so what you
// run is what you can read: the template with three values filled in (the
// Cockpit folder, the port, the version). Nothing else is generated.
//
//   node scripts/make-launcher.mjs                  # into ./launchers/
//   node scripts/make-launcher.mjs --out ~/Desktop  # anywhere you like
//   node scripts/make-launcher.mjs --print          # show it, write nothing
//   options: --port 4317  --platform mac|linux|windows
//
// THE ONE RULE THIS SCRIPT ENFORCES: a launcher is started by you, never by
// the computer. It refuses to write into any folder the operating system
// starts things from (LaunchAgents, LaunchDaemons, login items, autostart,
// systemd, cron, the Windows Startup folder), and the launcher itself
// contains no instruction that registers anything. Re-running it overwrites
// the same file, so it is safe to run again after moving the Cockpit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const COCKPIT_DIR = path.resolve(HERE, '..');
const TEMPLATE_DIR = path.join(COCKPIT_DIR, 'launcher');

export const PLATFORMS = {
  mac: { template: 'start-cockpit.sh.template', file: 'Start ICOR for Life Cockpit.command' },
  linux: { template: 'start-cockpit.sh.template', file: 'start-icor-for-life-cockpit.sh' },
  windows: { template: 'start-cockpit.cmd.template', file: 'Start ICOR for Life Cockpit.cmd' },
};

/**
 * Path segments of the places an operating system starts programs from by
 * itself. Matched case-insensitively against every segment of the output
 * folder, so a folder INSIDE one of them is refused too.
 */
export const AUTOSTART_SEGMENTS = [
  'launchagents', 'launchdaemons', 'startupitems', 'loginitems', 'login items',
  'autostart', 'systemd', 'cron.d', 'cron.daily', 'cron.hourly', 'crontabs',
  'startup', 'init.d', 'rc.d', 'xdg-autostart',
];

export function platformKey(p = process.platform) {
  if (p === 'darwin') return 'mac';
  if (p === 'win32') return 'windows';
  return 'linux';
}

/** Why this folder may not hold a launcher, or null when it may. */
export function autostartReason(dir) {
  const segs = path.resolve(dir).split(/[\\/]+/).map((s) => s.toLowerCase());
  const hit = segs.find((s) => AUTOSTART_SEGMENTS.includes(s));
  return hit ? `"${hit}" is a folder the system starts programs from` : null;
}

/**
 * Characters that cannot be carried safely inside a quoted shell or cmd value.
 * `& | < > ^` are legal in a Windows folder name and split a cmd line into a
 * second command wherever the value is echoed, so they are refused on every
 * platform: one rule, whichever launcher is made.
 */
const UNSAFE_PATH_RE = /["$`\\%\r\n!&|<>^]/;

export function checkCockpitDir(dir) {
  // Windows paths legitimately contain backslashes; everything else is refused.
  const probe = process.platform === 'win32' ? dir.replace(/\\/g, '/') : dir;
  if (UNSAFE_PATH_RE.test(probe)) {
    throw new Error(
      `The Cockpit folder path contains a character a launcher cannot carry safely ` +
        `(one of " $ \` \\ % ! & | < > ^ or a line break): ${dir}\nMove the folder to a plainer path and run this again.`,
    );
  }
}

export function render(templateText, values) {
  let out = templateText;
  for (const [k, v] of Object.entries(values)) out = out.split(`{{${k}}}`).join(String(v));
  const left = /\{\{[A-Z_]+\}\}/.exec(out);
  if (left) throw new Error(`Template placeholder ${left[0]} has no value.`);
  return out;
}

export function buildLauncher({ platform = platformKey(), port = 4317, cockpitDir = COCKPIT_DIR } = {}) {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error(`Unknown platform "${platform}". Use mac, linux or windows.`);
  const p = Number.parseInt(String(port), 10);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error(`Port must be 1024 to 65535, got ${port}.`);
  checkCockpitDir(cockpitDir);
  const version = JSON.parse(fs.readFileSync(path.join(cockpitDir, 'package.json'), 'utf8')).version;
  const text = render(fs.readFileSync(path.join(TEMPLATE_DIR, spec.template), 'utf8'), {
    COCKPIT_DIR: platform === 'windows' ? cockpitDir.replace(/\//g, '\\') : cockpitDir,
    PORT: p,
    VERSION: version,
  });
  return { file: spec.file, text: platform === 'windows' ? text.replace(/\r?\n/g, '\r\n') : text };
}

/**
 * Where a folder really is once every symlink on its way is followed. The
 * folder may not exist yet, so the deepest part that does exist is resolved
 * and the rest is appended. Nothing is created here: a refused folder must
 * never be made as a side effect of checking it.
 */
export function realTarget(dir) {
  let head = path.resolve(dir);
  const tail = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) break;
    tail.unshift(path.basename(head));
    head = up;
  }
  let real = head;
  try { real = fs.realpathSync(head); } catch { /* unreadable: judge the typed path */ }
  return path.join(real, ...tail);
}

export function writeLauncher({ outDir, ...opts }) {
  const dir = path.resolve(outDir.replace(/^~(?=$|[\\/])/, os.homedir()));
  // Both the path as typed and the path it really leads to: a symlink named
  // "Desktop" that points into LaunchAgents is refused like LaunchAgents.
  for (const candidate of [dir, realTarget(dir)]) {
    const reason = autostartReason(candidate);
    if (reason) throw new Error(`Refusing to write a launcher into ${candidate}: ${reason}. Pick a normal folder, for example your Desktop.`);
  }
  const { file, text } = buildLauncher(opts);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  fs.writeFileSync(target, text, { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  return target;
}

function parseArgs(argv) {
  const a = { outDir: path.join(COCKPIT_DIR, 'launchers'), port: process.env.PORT || 4317, platform: platformKey(), print: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--print') a.print = true;
    else if (k === '--out') a.outDir = argv[++i];
    else if (k === '--port') a.port = argv[++i];
    else if (k === '--platform') a.platform = argv[++i];
    else throw new Error(`Unknown option ${k}`);
  }
  if (!a.outDir) throw new Error('--out needs a folder.');
  return a;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const a = parseArgs(process.argv.slice(2));
    if (a.print) {
      process.stdout.write(buildLauncher(a).text);
    } else {
      const target = writeLauncher(a);
      console.log(`  Launcher written: ${target}`);
      console.log('  Start the Cockpit by opening that file. It runs until you close its window.');
      console.log('  It is never started by the computer on its own.');
    }
  } catch (err) {
    console.error(`  ${err.message}`);
    process.exit(1);
  }
}
