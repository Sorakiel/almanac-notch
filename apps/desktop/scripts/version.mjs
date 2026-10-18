// `npm run release:version 0.1.1` - one command to bump the app version everywhere.
// apps/desktop/package.json is the source of truth (tauri.conf.json points at it); the Rust crates
// and their lock files follow so `cargo` and the bundle agree. Prints the tag to push.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const v = process.argv[2];
if (!v || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v)) {
  console.error('usage: npm run release:version <x.y.z[-pre]>');
  process.exit(1);
}

const edit = (rel, fn) => {
  const p = join(desktop, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error('version: nothing changed in ' + rel);
  writeFileSync(p, after);
};

edit('package.json', (s) => s.replace(/("version":\s*")[^"]+"/, `$1${v}"`));
for (const toml of ['src-tauri/Cargo.toml', 'hook/Cargo.toml']) {
  edit(toml, (s) => s.replace(/^version = "[^"]+"/m, `version = "${v}"`));
}
// src-tauri depends on the hook crate by path, so its lock lists both
const bump = (name) => (s) => s.replace(new RegExp(`(name = "${name}"\\nversion = ")[^"]+"`), `$1${v}"`);
edit('src-tauri/Cargo.lock', (s) => bump('almanac-hook')(bump('almanac-notch')(s)));
edit('hook/Cargo.lock', bump('almanac-hook'));
console.log(`[version] ${v}. Commit, then: git tag v${v} && git push origin v${v}`);
