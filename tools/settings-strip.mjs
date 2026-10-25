// Stage 9f filmstrip: a settings window on a paused clock, one click on a sidebar row, then a frame
// every 1/60 s. Works for ours and for coucou's web build alike, so the two run side by side.
// node tools/settings-strip.mjs <url> <row text> <out-dir> [frames]
//   ours:   node tools/settings-strip.mjs http://127.0.0.1:1420/settings.html Звук .parity/strip/set-ours
//   coucou: node tools/settings-strip.mjs http://127.0.0.1:5288/settings.html "Горячие клавиши" .parity/strip/set-cc
// CSS and Web Animations do not follow Playwright's clock, so every frame pauses them all and sets
// their time by hand; requestAnimationFrame code (our sidebar's spring) follows the clock itself.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [url, row, dir, frames = '30'] = process.argv.slice(2);
if (!url || !row || !dir) {
  console.error('usage: node tools/settings-strip.mjs <url> <row text> <out-dir> [frames]');
  process.exit(1);
}
const N = +frames;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 820, height: 600 }, deviceScaleFactor: 1, locale: 'ru-RU' });
await p.clock.install({ time: 0 });
await p.clock.pauseAt(1000);
await p.goto(url);
await p.clock.runFor(2500);
// let animations from loading finish before the click
await p.evaluate(() => document.getAnimations().forEach((a) => a.finish?.()));

const target = p.getByText(row).filter({ visible: true }).first();
await target.click();
// the animations the click started, at their own start
await p.evaluate(() => {
  window.__stripAnims = document.getAnimations();
  for (const a of window.__stripAnims) a.pause();
});
for (let i = 0; i < N; i++) {
  const ms = (i * 1000) / 60;
  await p.evaluate(async (ms) => {
    for (const a of document.getAnimations()) {
      if (!window.__stripAnims.includes(a)) {
        a.pause();
        window.__stripAnims.push(a);
        a.__born = window.__stripMs ?? 0;
      }
      const t = ms - (a.__born ?? 0);
      // past its end an animation is finished for real, so code waiting on it runs
      if (t >= a.effect.getComputedTiming().endTime) a.finish();
      else a.currentTime = t;
    }
    window.__stripMs = ms;
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }, ms);
  await p.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png` });
  await p.clock.runFor(1000 / 60);
}
await b.close();
// a contact sheet, six frames a row, and a 60 fps clip
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', `${dir}/%03d.png`, '-vf', 'scale=410:-2,tile=6x' + Math.ceil(N / 6), '-frames:v', '1', `${dir}.png`]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', `${dir}/%03d.png`, '-pix_fmt', 'yuv420p', `${dir}.mp4`]);
console.log(`${N} frames → ${dir}/, ${dir}.png, ${dir}.mp4`);
