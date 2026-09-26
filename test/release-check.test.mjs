// Red tests for the release gates: scripts/release-check.mjs and the shape
// of .github/workflows/release.yml. Each gate is fed a case it must refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTag, notesFor } from '../scripts/release-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');

test('tag: a bare x.y.z equal to package.json passes', () => {
  assert.equal(checkTag('2.0.0', '2.0.0'), null);
});
test('tag: a v prefix is refused', () => {
  assert.match(checkTag('v2.0.0', '2.0.0'), /bare x\.y\.z/);
});
test('tag: a version other than package.json is refused', () => {
  assert.match(checkTag('2.0.1', '2.0.0'), /not package\.json version/);
});

const CL = '# Changelog\n\n## [2.0.1] - 2026-10-01\n\n- the fix\n\n## [2.0.0] - unreleased\n\n- old\n';
test('notes: the dated section only', () => {
  const r = notesFor(CL, '2.0.1');
  assert.ok(r.notes.includes('the fix'));
  assert.ok(!r.notes.includes('old'));
});
test('notes: an undated section is refused', () => {
  assert.match(notesFor(CL, '2.0.0').error, /write the release date/);
});
test('notes: a missing section is refused', () => {
  assert.match(notesFor(CL, '9.9.9').error, /no "## \[9\.9\.9\]" section/);
});

test('workflow: every action is pinned to a commit SHA', () => {
  const uses = [...WF.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, u);
});
test('workflow: attest-build-provenance is 4d101475, on its own job with id-token', () => {
  assert.ok(WF.includes('actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8'));
  const jobs = WF.split(/\n  (?=[a-z-]+:\n)/);
  const withId = jobs.filter((j) => j.includes('id-token: write'));
  assert.equal(withId.length, 1, 'exactly one job may hold id-token');
  assert.ok(withId[0].includes('attest-build-provenance'), 'the id-token job is the attesting job');
  assert.ok(!withId[0].includes('npm '), 'the attesting job runs no npm');
});
test('workflow: bare semver tag trigger, draft first, publish last after verify and the one-byte red case', () => {
  assert.ok(WF.includes("- '[0-9]+.[0-9]+.[0-9]+'"));
  const J = WF.indexOf('\njobs:');  // past the header comment, which names the same words
  const at = (x) => WF.indexOf(x, J);
  const draft = at('gh release create'), up = at('gh release upload');
  const verify = at('gh attestation verify'), red = at('cp "dl/$ASSET" bad.tar.gz');
  const pub = at('--draft=false');
  assert.ok(draft > 0 && WF.slice(draft, draft + 400).includes('--draft'), 'the release starts as a draft');
  assert.ok(draft < up && up < verify && verify < red && red < pub, 'draft, upload, verify, red case, publish');
});

// The archive the workflow ships is `git archive` of the tag, built twice.
function archive(repo, out) {
  execFileSync('git', ['-C', repo, 'archive', '--format=tar.gz', '--prefix=x/', '-o', out, 'HEAD']);
  return readFileSync(out);
}
test('asset: git archive of one commit is byte-identical when built twice', () => {
  const d = mkdtempSync(join(tmpdir(), 'cockpit-arch-'));
  try {
    execFileSync('git', ['-C', d, 'init', '-q']);
    writeFileSync(join(d, 'a.txt'), 'a\n');
    execFileSync('git', ['-C', d, 'add', 'a.txt']);
    execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@l', '-c', 'commit.gpgsign=false',
      'commit', '-qm', 'a']);
    const one = archive(d, join(d, '1.tgz'));
    const two = archive(d, join(d, '2.tgz'));
    assert.ok(one.equals(two), 'two builds differ');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
