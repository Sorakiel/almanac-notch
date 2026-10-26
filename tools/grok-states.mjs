// Stage 9g: our mascot in the same moments as the Grok Bot case's character clips (04_*.webm),
// 8 samples across each clip's length, one row per state -> <out>/ours-states.png
// node tools/grok-states.mjs [out-dir]   (the app page on :1420)
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const out = process.argv[2] ?? '.parity/9g';
const dir = `${out}/states`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
// name, length (s) of the Grok clip, what to do
const STATES = [
  ['Annoyed', 1.35, 'poke3'], ['Dizzy', 1.25, 'poke6'], ['Error', 2.37, 'ev:error'], ['Finished', 3.68, 'ev:success'],
  ['Follow', 2.37, 'follow'], ['Slap', 1.25, 'poke1'], ['Working', 2.7, 'ev:working'],
];
const b = await chromium.launch();
for (const [name, len, act] of STATES) {
  const p = await b.newPage({ viewport: { width: 680, height: 230 }, deviceScaleFactor: 2 });
  await p.clock.install({ time: 0 });
  await p.clock.pauseAt(1000);
  await p.goto('http://127.0.0.1:1420/');
  await p.clock.runFor(3000);
  await p.evaluate(() => { const s = window.__state; s.event = null; s.postLaunchUntil = 0; s.host.openOnHover = true; });
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  const mascot = () => p.evaluate(() => window.__state.islandMascot);
  let m = await mascot();
  if (act.startsWith('ev:')) await p.evaluate((a) => window.__debug(a), act);
  else if (act.startsWith('poke')) {
    const n = +act.slice(4);
    for (let i = 0; i < n; i++) { await p.mouse.move(m.x, m.y); await p.mouse.down(); await p.mouse.up(); await p.clock.runFor(120); }
  }
  const N = 8;
  for (let i = 0; i < N; i++) {
    m = (await mascot()) ?? m;
    if (act === 'follow') await p.mouse.move(m.x + 150 * Math.cos(i), m.y + 60 * Math.sin(i * 1.7));
    await p.screenshot({ path: `${dir}/${name}-${i}.png`, clip: { x: Math.max(0, m.x - 70), y: Math.max(0, m.y - 55), width: 140, height: 110 } });
    await p.clock.runFor((len * 1000) / (N - 1));
  }
  await p.close();
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', `${dir}/${name}-%d.png`, '-vf', 'scale=200:-1,tile=8x1', '-frames:v', '1', `${dir}/row-${name}.png`]);
}
await b.close();
execFileSync('ffmpeg', ['-v', 'error', '-y', ...STATES.flatMap(([n]) => ['-i', `${dir}/row-${n}.png`]), '-filter_complex', `vstack=inputs=${STATES.length}`, `${out}/ours-states.png`]);
console.log(`${out}/ours-states.png`);
