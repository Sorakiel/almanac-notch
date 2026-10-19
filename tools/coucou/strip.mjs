import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [view = 'prompt', N = 36] = process.argv.slice(2);
const out = process.env.OUT, dir = `${out}/cc-${view}`;
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 720, height: 260 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 120)));
await p.clock.install({ time: 0 });
await p.clock.pauseAt(1000);
await p.goto('http://127.0.0.1:5288/dev/tabs-preview.html');
await p.clock.runFor(2000);
await p.evaluate(() => window.island.expand('overview'));
await p.clock.runFor(2000);
await p.evaluate((v) => window.island.setView(v), view);
for (let i = 0; i < +N; i++) {
  await p.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png`, clip: { x: 0, y: 0, width: 720, height: 230 } });
  await p.clock.runFor(1000 / 60);
}
await b.close();
execFileSync('ffmpeg', ['-v','error','-y','-framerate','60','-i',`${dir}/%03d.png`,'-vf',`scale=480:-1,pad=iw+4:ih+4:2:2:white,tile=6x${Math.ceil(N/6)}`,'-frames:v','1',`${out}/cc-${view}.png`]);
console.log(`${out}/cc-${view}.png`);
