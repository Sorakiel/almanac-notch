// Stage 9 filmstrip: the app page on a virtual clock, one action, then the island every 1/60 s.
// node tools/strip.mjs <scene> [out-dir]  - scenes: open, focus, ev-error, ev-attention, focus-back, tab-chat, tab-settings, tab-home,
//   rail-sweep (the pointer down the focus card's mascot stack and back up), autoclose (click-open, leave, fold)
// Writes frames to <out-dir>/<scene>/NNN.png and a contact sheet <out-dir>/<scene>.png (ffmpeg).
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const scene = process.argv[2] ?? 'tab-chat';
const out = process.argv[3] ?? '.parity/strip';
const N = +(process.env.FRAMES ?? 36);
const dir = `${out}/${scene}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 680, height: 230 }, deviceScaleFactor: 2 });
// paused clock: only runFor moves time, so a slow screenshot does not skip frames
await p.clock.install({ time: 0 });
await p.clock.pauseAt(1000);
await p.goto('http://127.0.0.1:1420/');
await p.clock.runFor(3000);
await p.evaluate(() => {
  const s = window.__state;
  s.event = null;
  s.postLaunchUntil = 0;
  s.host.openOnHover = true;
});
await p.mouse.move(5, 225);
await p.clock.runFor(1500);

const box = () => p.evaluate(() => window.__state.islandBox);
async function clickTab(i, right = false) {
  const bx = await box();
  const x = right ? bx.x1 - 62 : bx.x0 + 26 + i * 40;
  await p.mouse.move(x, 16);
  await p.mouse.down();
  await p.mouse.up();
}
let frame = 0;
async function shoot() {
  for (let n = 0; n < N; n++) {
    const i = frame++;
    // fixed frame: the island grows inside it, as on screen
    await p.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png`, clip: { x: 30, y: 0, width: 620, height: 190 } });
    if (process.env.DEBUG) console.log(i, await p.evaluate(() => [window.__state.t - window.__state.tabStart, window.__state.t - window.__state.revealStart].map((v) => v.toFixed(3)).join(' ')));
    await p.clock.runFor(1000 / 60);
  }
}

if (scene === 'hover-mascot') {
  // the agent working, the pointer onto the card's mascot, then off it
  await p.mouse.move(340, 12);
  await p.clock.runFor(800);
  await p.evaluate(() => window.__debug('ev:working'));
  await p.clock.runFor(1500);
  const m = await p.evaluate(() => window.__state.islandMascot);
  await p.mouse.move(m.x, m.y);
  await shoot();
  await p.mouse.move(m.x + 140, m.y);
  await shoot();
} else if (scene === 'hover-pill') {
  // hover the first module pill, then leave it
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  const h = await p.evaluate(() => window.__state.hits.find((x) => x.act.startsWith('focus:')));
  await p.mouse.move(h.x + h.w / 2, h.y + h.h / 2);
  await shoot();
} else if (scene === 'focus' || scene === 'focus-back') {
  // click a module pill: its mascot flies into the focus card, the pills slide over
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  const pill = (i) => p.evaluate((i) => window.__state.hits.filter((x) => x.act.startsWith('focus:'))[i], i);
  let h = await pill(1);
  if (scene === 'focus-back') {
    await p.mouse.move(h.x + h.w / 2, h.y + h.h / 2);
    await p.mouse.down();
    await p.mouse.up();
    await p.clock.runFor(1500);
    h = await pill(1);
  }
  await p.mouse.move(h.x + h.w / 2, h.y + h.h / 2);
  await p.mouse.down();
  await p.mouse.up();
  // off the pills, so hover does not colour the frames
  await p.mouse.move(340, 12);
  await shoot();
} else if (scene === 'rail-sweep') {
  // focus a module, then slide the pointer over every mascot of the rail, down and back up, at
  // about a hand's speed (0.9 s each way), and let it rest off the rail
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  // RAIL=music: the player with the stack beside it; RAIL=ev-<type>: an event card with the stack
  const via = process.env.RAIL ?? 'music';
  if (via.startsWith('ev-')) await p.evaluate((e) => window.__debug('ev:' + e), via.slice(3));
  else {
    const h = await p.evaluate((id) => window.__state.hits.find((x) => x.act === 'focus:' + id), via);
    await p.mouse.move(h.x + h.w / 2, h.y + h.h / 2);
    await p.mouse.down();
    await p.mouse.up();
  }
  await p.clock.runFor(1500);
  const rail = await p.evaluate(() => {
    const r = window.__state.hits.filter((x) => x.act.startsWith('focus:'));
    return { x: r[0].x + r[0].w / 2, y0: r[0].y + 4, y1: r[r.length - 1].y + r[r.length - 1].h - 4 };
  });
  const steps = 54;
  for (const [a, z] of [[rail.y0, rail.y1], [rail.y1, rail.y0]]) {
    for (let n = 0; n <= steps; n++) {
      await p.mouse.move(rail.x, a + ((z - a) * n) / steps);
      const i = frame++;
      await p.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png`, clip: { x: 30, y: 0, width: 620, height: 190 } });
      await p.clock.runFor(1000 / 60);
    }
  }
  await p.mouse.move(rail.x - 200, 12);
  await shoot();
} else if (scene === 'autoclose') {
  // the island opened by a click, then the pointer leaves: the countdown, then the fold
  await p.evaluate(() => (window.__state.host.openOnHover = false));
  await p.mouse.move(340, 12);
  await p.clock.runFor(800);
  await p.mouse.down();
  await p.mouse.up();
  await p.clock.runFor(1500);
  await p.mouse.move(5, 225);
  await p.clock.runFor(1500);
  await shoot();
} else if (scene.startsWith('ev-')) {
  // an event on the open island: ev-error, ev-success, ev-attention, ev-question
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  await p.evaluate((e) => window.__debug('ev:' + e), scene.slice(3));
  await shoot();
} else if (scene === 'open') {
  await p.evaluate(() => window.dispatchEvent(new Event('blur')));
  await p.clock.runFor(1500);
  await p.mouse.move(340, 12);
  await shoot();
} else {
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  if (scene === 'tab-home') {
    await clickTab(1);
    await p.clock.runFor(1500);
    await clickTab(0);
  } else if (scene === 'tab-settings') await clickTab(0, true);
  else await clickTab(1);
  await shoot();
}
await b.close();
const cols = 6;
const total = frame;
execFileSync('ffmpeg', [
  '-v', 'error', '-y', '-framerate', '60', '-i', `${dir}/%03d.png`,
  '-vf', `scale=480:-1,pad=iw+4:ih+4:2:2:white,tile=${cols}x${Math.ceil(total / cols)}`,
  '-frames:v', '1', `${out}/${scene}.png`,
]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '60', '-i', `${dir}/%03d.png`, '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', `${out}/${scene}.mp4`]);
console.log(`${out}/${scene}.png`);
