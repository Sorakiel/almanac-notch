// coucou's drop sequence (windows/dev/upload-preview.html) on a virtual clock, 1/60 s a frame,
// to put next to ours (tools/strip.mjs shelf-drop). The page drops at t = 1.2 s.
// node tools/coucou/upload.mjs [out-dir] - needs coucou's vite on 5288 (tools/coucou/README.md)
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = process.argv[2] ?? '.parity/strip';
const dir = `${out}/cc-upload`;
const FROM = +(process.env.FROM ?? 0.8),
  N = +(process.env.FRAMES ?? 150);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 700, height: 240 }, deviceScaleFactor: 2 });
await p.clock.install({ time: 0 });
await p.clock.pauseAt(1000);
await p.goto('http://127.0.0.1:5288/dev/upload-preview.html');
await p.clock.runFor(FROM * 1000);
const st = await p.locator('#stage').boundingBox();
for (let i = 0; i < N; i++) {
  await p.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png`, clip: st });
  await p.clock.runFor(1000 / 60);
}
await b.close();
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '60', '-i', `${dir}/%03d.png`, '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', `${out}/cc-upload.mp4`]);
console.log(`${out}/cc-upload.mp4`);
