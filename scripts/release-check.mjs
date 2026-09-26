#!/usr/bin/env node
// release-check.mjs: the deterministic gates of .github/workflows/release.yml.
//
// Every check the release makes that needs no network lives here, so it runs
// the same on a laptop as on the runner and can be watched going red
// (test/release-check.test.mjs). The workflow calls it and never re-implements
// a gate in shell.
//
//   node scripts/release-check.mjs tag <tag>             the tag is a bare x.y.z equal to package.json
//   node scripts/release-check.mjs notes <version> <out> the dated CHANGELOG section, written to <out>
//
// Exit 0 = gate green. Exit 1 = gate red, one `error:` line on stderr.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

export function checkTag(tag, pkgVersion) {
  if (!SEMVER.test(tag)) return `tag ${JSON.stringify(tag)} is not a bare x.y.z (no v prefix)`;
  if (tag !== pkgVersion) return `tag ${tag} is not package.json version ${pkgVersion}`;
  return null;
}

// The `## [x.y.z] - YYYY-MM-DD` section, heading included, up to the next `## [`.
export function notesFor(changelog, version) {
  const lines = changelog.split('\n');
  const head = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - (.+)$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return { error: `CHANGELOG.md has no "## [${version}]" section` };
  const date = head.exec(lines[start])[1].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: `the CHANGELOG section for ${version} is dated "${date}"; write the release date before the tag` };
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) return { error: `the CHANGELOG section for ${version} is empty` };
  return { notes: `${lines[start]}\n\n${body}\n` };
}

function die(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b] = process.argv.slice(2);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (cmd === 'tag' && a) {
    const err = checkTag(a, pkg.version);
    if (err) die(err);
    process.stdout.write(`version=${a}\n`);
  } else if (cmd === 'notes' && a && b) {
    const r = notesFor(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), a);
    if (r.error) die(r.error);
    writeFileSync(b, r.notes);
    process.stdout.write(`notes=${b}\n`);
  } else {
    die('usage: release-check.mjs tag <tag> | notes <version> <out>');
  }
}
