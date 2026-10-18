// One command for a ready installer: `npm run installer` from the repository root.
// Builds the release bundle for this OS and copies it to <root>/release/:
//   Windows - "Almanac Notch Setup.exe" (NSIS), Mac - "Almanac Notch.dmg" and "Almanac Notch.app".
// Update artifacts (.app.tar.gz / signed setup) need the updater key: without
// TAURI_SIGNING_PRIVATE_KEY they are skipped, so a local build works without it.
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

// Mac: the self-signed "Almanac Notch" certificate gives every build the same signature, so the
// keychain and calendar permissions survive rebuilds and updates. Tauri signs only with a trusted
// identity in the keychain (README, "Релиз" - one-time setup); without it the build is ad-hoc.
if (mac && !process.env.APPLE_SIGNING_IDENTITY) {
  const ids = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout ?? '';
  if (ids.includes('"Almanac Notch"')) process.env.APPLE_SIGNING_IDENTITY = 'Almanac Notch';
  else console.log('[installer] no "Almanac Notch" signing certificate: ad-hoc signature');
}
const args = ['tauri', 'build', '--bundles', win ? 'nsis' : 'app,dmg'];
if (!process.env.TAURI_SIGNING_PRIVATE_KEY)
  args.push('-c', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
const r = spawnSync('npx', args, { cwd: desktop, stdio: 'inherit', shell: win });
if (r.status !== 0) process.exit(r.status ?? 1);

const out = join(root, 'release');
mkdirSync(out, { recursive: true });
/** newest file with this ending in the bundle folder, copied to release/ under `name` */
function take(kind, ending, name) {
  const dir = join(desktop, 'src-tauri', 'target', 'release', 'bundle', kind);
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith(ending))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!newest) throw new Error('installer: nothing in ' + dir);
  const dest = join(out, name);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(newest, dest, { recursive: true });
  console.log('[installer] ready: ' + dest);
}
if (win) take('nsis', '.exe', 'Almanac Notch Setup.exe');
else {
  take('dmg', '.dmg', 'Almanac Notch.dmg');
  take('macos', '.app', 'Almanac Notch.app');
}
