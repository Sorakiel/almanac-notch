// One command for a ready installer: `npm run installer` from the repository root.
// Builds the release bundle for this OS and copies it to <root>/release/:
//   Windows - "Almanac Notch Setup.exe" (NSIS), Mac - "Almanac Notch.app".
// Tauri itself leaves it deep inside src-tauri/target/release/bundle/..., which is build output
// and not in git.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '..', '..');
const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
if (!win && !mac) throw new Error('installer: only Windows and macOS');

const r = spawnSync('npx', ['tauri', 'build', '--bundles', win ? 'nsis' : 'app'], {
  cwd: desktop,
  stdio: 'inherit',
  shell: win,
});
if (r.status !== 0) process.exit(r.status ?? 1);

const bundle = join(desktop, 'src-tauri', 'target', 'release', 'bundle', win ? 'nsis' : 'macos');
const newest = readdirSync(bundle)
  .filter((f) => (win ? f.endsWith('.exe') : f.endsWith('.app')))
  .map((f) => join(bundle, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!newest) throw new Error('installer: nothing in ' + bundle);

const out = join(root, 'release');
mkdirSync(out, { recursive: true });
const dest = join(out, win ? 'Almanac Notch Setup.exe' : 'Almanac Notch.app');
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
cpSync(newest, dest, { recursive: true });
console.log('\n[installer] ready: ' + dest);
