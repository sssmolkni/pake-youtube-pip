#!/usr/bin/env node
// Proves the built app actually has WebKit's element-fullscreen support compiled in.
//
// wry only sets the WKWebView `fullScreenEnabled` preference under
// `#[cfg(feature = "fullscreen")]`, which comes from tauri's `macos-private-api`.
// Cargo records the exact feature set it compiled each crate with in the
// fingerprint JSON, so that is the ground truth — not the Cargo.toml.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localTarget = path.join(repoRoot, '.cargo-target');
const targetDir =
  process.env.CARGO_TARGET_DIR ||
  (existsSync(localTarget)
    ? localTarget
    : path.join(repoRoot, 'node_modules', 'pake-cli', 'src-tauri', 'target'));

if (!existsSync(targetDir)) {
  console.error(`no cargo target dir at ${targetDir} — build the app first.`);
  process.exit(1);
}

// Layout: <target>/<triple>/<profile>/.fingerprint/<crate>-<hash>/lib-<crate>.json
const roots = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === '.fingerprint') roots.push(full);
    else if (entry.name !== 'deps' && entry.name !== 'build') walk(full);
  }
})(targetDir);

const wanted = { wry: 'fullscreen', tauri: 'macos-private-api' };
const found = {};

for (const root of roots) {
  for (const crateDir of readdirSync(root, { withFileTypes: true })) {
    if (!crateDir.isDirectory()) continue;
    const crate = crateDir.name.replace(/-[0-9a-f]{8,}$/, '');
    if (!(crate in wanted)) continue;
    const dir = path.join(root, crateDir.name);
    for (const file of readdirSync(dir)) {
      if (!file.startsWith('lib-') || !file.endsWith('.json')) continue;
      const full = path.join(dir, file);
      let features;
      try {
        features = JSON.parse(readFileSync(full, 'utf8')).features;
      } catch {
        continue;
      }
      if (typeof features !== 'string' && !Array.isArray(features)) continue;
      const list = Array.isArray(features)
        ? features
        : features.replace(/^\[|\]$/g, '').split(/,\s*/).map((f) => f.replace(/"/g, ''));
      const prev = found[crate];
      const mtime = statSync(full).mtimeMs;
      if (!prev || mtime > prev.mtime) found[crate] = { list, mtime };
    }
  }
}

let ok = true;
for (const [crate, feature] of Object.entries(wanted)) {
  const entry = found[crate];
  if (!entry) {
    console.log(`? ${crate}: no fingerprint found under ${targetDir}`);
    ok = false;
    continue;
  }
  const has = entry.list.includes(feature);
  if (!has) ok = false;
  console.log(`${has ? '✓' : '✗'} ${crate}: ${entry.list.join(', ')}`);
}

console.log(
  ok
    ? '\nNative WebKit element fullscreen is compiled in.'
    : '\nMissing features — the app will fall back to Pake’s fullscreen polyfill.',
);
process.exit(ok ? 0 : 1);
