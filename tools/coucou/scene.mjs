// coucou side of the stage 9g pairs: one scene on the paused clock, a frame every 1/60 s.
// OUT=.parity/9g node tools/coucou/scene.mjs <open|close> [frames]
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [scene = 'open', N = 36] = process.argv.slice(2);
const out = process.env.OUT ?? '.parity/9g', dir = `${out}/cc-${scene}`;
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 720, height: 260 }, deviceScaleFactor: 2 });
await p.clock.install({ time: 0 });
await p.clock.pauseAt(1000);
await p.goto('http://127.0.0.1:5288/dev/tabs-preview.html');
await p.clock.runFor(2000);
if (scene === 'close') { await p.evaluate(() => window.island.expand('overview')); await p.clock.runFor(2500); await p.evaluate(() => window.island.collapse()); }
else await p.evaluate(() => window.island.expand('overview'));
for (let i = 0; i < +N; i++) {
  await p.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png`, clip: { x: 0, y: 0, width: 720, height: 230 } });
  await p.clock.runFor(1000 / 60);
}
await b.close();
execFileSync('ffmpeg', ['-v','error','-y','-framerate','60','-i',`${dir}/%03d.png`,'-vf',`scale=480:-1,pad=iw+4:ih+4:2:2:white,tile=6x${Math.ceil(N/6)}`,'-frames:v','1',`${out}/cc-${scene}.png`]);
console.log(`${out}/cc-${scene}.png`);
