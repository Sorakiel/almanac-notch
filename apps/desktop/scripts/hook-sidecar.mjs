// Builds the hook client (apps/desktop/hook) and puts it where Tauri's `externalBin` looks:
// src-tauri/binaries/almanac-hook-<target triple>[.exe]. The bundle then ships it next to the
// app's executable, and the hook installer copies it from there (claude/hooks_ui.rs).
// Runs before `tauri dev` and `tauri build`; TAURI_ENV_TARGET_TRIPLE is set by the Tauri CLI.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const host = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || host;
if (!triple) throw new Error('no target triple: rustc -vV gave no host');

const manifest = join(root, 'hook', 'Cargo.toml');
const build = (t) =>
  execFileSync('cargo', ['build', '--release', '--quiet', '--manifest-path', manifest, '--target', t], {
    stdio: 'inherit',
  });
const exe = triple.includes('windows') ? '.exe' : '';
const out = join(root, 'src-tauri', 'binaries');
mkdirSync(out, { recursive: true });
const dest = join(out, `almanac-hook-${triple}${exe}`);
const built = (t) => join(root, 'hook', 'target', t, 'release', 'almanac-hook' + exe);
if (triple === 'universal-apple-darwin') {
  // one Mac release for Apple silicon and Intel: both slices glued by lipo
  const parts = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
  for (const t of parts) {
    build(t);
    // tauri-build checks each slice's own file too
    copyFileSync(built(t), join(out, `almanac-hook-${t}`));
  }
  execFileSync('lipo', ['-create', '-output', dest, ...parts.map(built)]);
} else {
  build(triple);
  copyFileSync(built(triple), dest);
}
console.log(`[hook-sidecar] almanac-hook for ${triple}`);
