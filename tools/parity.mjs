#!/usr/bin/env node
// npm run parity: build the harness, serve the build, shoot the port's frames, compare with reference/screens.
//
//   node tools/parity.mjs                    all scenes
//   node tools/parity.mjs --only stage-idle  one scene (passed through to snapshot.mjs)
//
// A production build is served instead of the dev server: the dev server's HMR client reloads the page
// when a module changed shortly before, which restarts the scene mid-way and shifts the frame.
import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolve(root, 'apps/harness');
const port = 5174; // leaves 5173 to a running dev server
const args = process.argv.slice(2);

await build({ root: harness, configFile: resolve(harness, 'vite.config.ts'), logLevel: 'warn' });
const server = await preview({
  root: harness,
  configFile: resolve(harness, 'vite.config.ts'),
  preview: { port, strictPort: true },
  logLevel: 'warn',
});
// async: the preview server lives in this process and must keep serving while the child runs
const run = (script, extra) =>
  new Promise((done) =>
    spawn(process.execPath, [resolve(root, 'tools', script), ...extra], { stdio: 'inherit', cwd: root }).on('exit', done),
  );
let code;
try {
  code = await run('snapshot.mjs', ['--target', 'port', '--url', `http://localhost:${port}/harness.html`, ...args]);
  if (code === 0) code = await run('compare.mjs', []);
} finally {
  await server.close();
}
process.exit(code ?? 1);
