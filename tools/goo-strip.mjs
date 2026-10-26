// Stage 9f: frames of the settings window's opening sequence (apps/desktop/design/goo.html), one
// every 1/60 s, a contact sheet and a 60 fps clip (also 4x slower). Needs desktop-web on 1420.
// node tools/goo-strip.mjs [out-dir] [seconds]
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2] ?? '.parity/strip/goo';
const secs = +(process.argv[3] ?? 1.5);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1710, height: 1107 }, deviceScaleFactor: 1 });
await p.goto('http://127.0.0.1:1420/design/goo.html?film');
await p.waitForFunction(() => window.__goo?.ready());
const N = Math.round(secs * 60) + 1;
const canvas = p.locator('canvas');
for (let i = 0; i < N; i++) {
  await p.evaluate((t) => window.__goo.setT(t), i / 60);
  await canvas.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png` });
}
await b.close();
const every = Math.max(1, Math.round(N / 18));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', `${dir}/%03d.png`, '-vf', `select='not(mod(n\\,${every}))',scale=420:-2,tile=6x3`, '-frames:v', '1', `${dir}.png`]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', `${dir}/%03d.png`, '-vf', 'scale=1140:-2', '-pix_fmt', 'yuv420p', `${dir}.mp4`]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${dir}.mp4`, '-vf', 'setpts=4*PTS', '-r', '60', '-pix_fmt', 'yuv420p', `${dir}-slow4x.mp4`]);
console.log(`${N} frames (every ${every} on the sheet) → ${dir}.png, ${dir}.mp4, ${dir}-slow4x.mp4`);
