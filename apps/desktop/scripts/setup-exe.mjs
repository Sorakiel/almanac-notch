// Windows only: `node apps/desktop/scripts/setup-exe.mjs [out.exe]` - our Setup.exe (stage 8g).
// Takes the NSIS installer that `tauri build` just made, embeds it into apps/desktop/setup (the
// installer window) and writes the result to `out.exe` (default: <root>/release/Almanac Notch
// Setup.exe). Used by scripts/installer.mjs and by the release workflow.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '..', '..');
if (process.platform !== 'win32') throw new Error('setup-exe: Setup.exe is built on Windows');

const bundle = join(desktop, 'src-tauri', 'target', 'release');
const nsisDir = join(bundle, 'bundle', 'nsis');
const nsis = readdirSync(nsisDir)
  .filter((f) => f.endsWith('-setup.exe'))
  .map((f) => join(nsisDir, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!nsis) throw new Error('setup-exe: no NSIS installer in ' + nsisDir + ' - run tauri build first');

// what lands in the install folder, for the progress bar
const bytes =
  statSync(join(bundle, 'almanac-notch.exe')).size +
  statSync(join(desktop, 'src-tauri', 'binaries', 'almanac-hook-x86_64-pc-windows-msvc.exe')).size;

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: desktop, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npm', ['run', 'build:setup-web']);
run('cargo', ['build', '--release', '--manifest-path', 'setup/Cargo.toml'], {
  ALMANAC_NSIS: nsis,
  ALMANAC_INSTALL_BYTES: String(bytes),
});

const out = process.argv[2] ?? join(root, 'release', 'Almanac Notch Setup.exe');
mkdirSync(dirname(out), { recursive: true });
copyFileSync(join(desktop, 'setup', 'target', 'release', 'almanac-setup.exe'), out);
console.log('[setup-exe] ' + nsis + ' -> ' + out);
