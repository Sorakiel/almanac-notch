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
execFileSync('cargo', ['build', '--release', '--quiet', '--manifest-path', manifest, '--target', triple], {
  stdio: 'inherit',
});
const exe = triple.includes('windows') ? '.exe' : '';
const out = join(root, 'src-tauri', 'binaries');
mkdirSync(out, { recursive: true });
copyFileSync(
  join(root, 'hook', 'target', triple, 'release', 'almanac-hook' + exe),
  join(out, `almanac-hook-${triple}${exe}`),
);
console.log(`[hook-sidecar] almanac-hook for ${triple}`);
