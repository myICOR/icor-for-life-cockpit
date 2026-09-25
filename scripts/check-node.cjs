// check-node.cjs - is this Node.js new enough to run the Cockpit?
//
// Written in deliberately old JavaScript (var, no arrow functions, no
// optional chaining) so that even a very old Node can run it and print a
// clear sentence, instead of crashing on syntax it does not know. Everything
// else in the Cockpit may use modern syntax; this file may not.
//
// The minimum comes from package.json "engines.node" (">=20"), so there is
// one place to change it.
//
// Exit codes: 0 = OK, 1 = too old or unreadable version.
// Usage: node scripts/check-node.cjs [--quiet]

var fs = require('fs');
var path = require('path');

var quiet = process.argv.indexOf('--quiet') !== -1;

function minimumMajor() {
  try {
    var pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    var m = /(\d+)/.exec(String((pkg.engines && pkg.engines.node) || ''));
    if (m) return parseInt(m[1], 10);
  } catch (e) {
    // fall through to the built-in floor
  }
  return 20;
}

var min = minimumMajor();
var current = String(process.versions && process.versions.node || '');
var major = parseInt(current.split('.')[0], 10);

if (!(major >= min)) {
  console.error('');
  console.error('  The ICOR for Life - Cockpit needs Node.js ' + min + ' or newer.');
  console.error('  This computer has Node.js ' + (current || 'unknown') + '.');
  console.error('  Install the current LTS from https://nodejs.org and run this again.');
  console.error('');
  process.exit(1);
}

if (!quiet) console.log('  Node.js ' + current + ' OK (needs ' + min + ' or newer).');
