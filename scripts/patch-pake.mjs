#!/usr/bin/env node
// Applies this repo's patches to the locally installed pake-cli.
//
// pake-cli compiles src-tauri from inside its own npm package, so the only way
// to change how the app's WebView is built is to patch the installed copy. The
// patches live in patches/ and are applied here on postinstall and before every
// build. Idempotent: re-running is a no-op.
//
// See README.md ("Patched Pake") for what the patches do and when to drop them.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pakeDir = path.join(repoRoot, 'node_modules', 'pake-cli');
const patchDir = path.join(repoRoot, 'patches');

// The patches carry file context from this exact release. A version bump must
// fail loudly rather than silently produce an app without the fix.
const EXPECTED_VERSION = '3.15.3';

function fail(message) {
  console.error(`\n  patch-pake: ${message}\n`);
  process.exit(1);
}

let installedVersion;
try {
  installedVersion = JSON.parse(
    readFileSync(path.join(pakeDir, 'package.json'), 'utf8'),
  ).version;
} catch {
  fail(`pake-cli is not installed at ${pakeDir}. Run \`npm ci\` first.`);
}

if (installedVersion !== EXPECTED_VERSION) {
  fail(
    `pake-cli is ${installedVersion}, but the patches in patches/ were written ` +
      `against ${EXPECTED_VERSION}.\n  Re-generate them against the new version ` +
      `(or drop them if the fix has landed upstream) and update EXPECTED_VERSION.`,
  );
}

// `git apply --directory` is relative to the repo root, and the patches are
// written with a/src-tauri/... paths, so -p1 strips the a/ prefix.
function gitApply(args, patch) {
  execFileSync(
    'git',
    ['apply', '-p1', '--directory=node_modules/pake-cli', ...args, patch],
    { cwd: repoRoot, stdio: 'pipe' },
  );
}

function canApply(args, patch) {
  try {
    gitApply(args, patch);
    return true;
  } catch {
    return false;
  }
}

const patches = readdirSync(patchDir)
  .filter((name) => name.endsWith('.patch'))
  .sort();

if (patches.length === 0) fail(`no patches found in ${patchDir}`);

const applied = [];
const skipped = [];

for (const name of patches) {
  const patch = path.join(patchDir, name);
  if (canApply(['--check'], patch)) {
    gitApply([], patch);
    applied.push(name);
  } else if (canApply(['--check', '-R'], patch)) {
    // Reverse-applies cleanly => it is already in place.
    skipped.push(name);
  } else {
    fail(
      `${name} does not apply to pake-cli ${installedVersion} and is not already ` +
        `applied.\n  The installed package may be dirty — try ` +
        `\`rm -rf node_modules && npm ci\`.`,
    );
  }
}

const summary = [
  applied.length ? `applied ${applied.length}` : null,
  skipped.length ? `${skipped.length} already applied` : null,
]
  .filter(Boolean)
  .join(', ');

console.log(`patch-pake: pake-cli ${installedVersion} — ${summary}.`);
