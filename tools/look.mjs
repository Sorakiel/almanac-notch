// Stage 9: still frames of the app island in its main states, for side by side checks with
// the references. node tools/look.mjs [out-dir] - writes <out>/<state>.png and <out>/sheet.png.
// Needs the desktop-web dev server on 1420 (.claude/launch.json).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = process.argv[2] ?? '.parity/look';
mkdirSync(out, { recursive: true });
const STATES = [
  ['home', null],
  ['chat', 'tab:chat'],
  ['attention', 'ev:attention'],
  ['question', 'ev:question'],
  ['success', 'ev:success'],
  ['error', 'ev:error'],
];
const b = await chromium.launch();
for (const [name, act] of STATES) {
  const p = await b.newPage({ viewport: { width: 680, height: 230 }, deviceScaleFactor: 2 });
  await p.clock.install({ time: 0 });
  await p.clock.pauseAt(1000);
  await p.goto('http://127.0.0.1:1420/');
  await p.clock.runFor(3000);
  await p.evaluate(() => {
    const s = window.__state;
    s.event = null;
    s.postLaunchUntil = 0;
    window.__debug('nstate:open');
  });
  await p.clock.runFor(1500);
  if (act?.startsWith('tab:')) await p.evaluate((t) => (window.__state.tab = t), act.slice(4));
  else if (act) await p.evaluate((a) => window.__debug(a), act);
  await p.clock.runFor(1500);
  await p.screenshot({ path: `${out}/${name}.png`, clip: { x: 30, y: 0, width: 620, height: 190 } });
  await p.close();
}
await b.close();
execFileSync('ffmpeg', [
  '-v', 'error', '-y',
  ...STATES.flatMap(([n]) => ['-i', `${out}/${n}.png`]),
  '-filter_complex', `${STATES.map((_, i) => `[${i}]pad=iw+8:ih+8:4:4:white[p${i}]`).join(';')};${STATES.map((_, i) => `[p${i}]`).join('')}xstack=inputs=${STATES.length}:layout=0_0|w0_0|0_h0|w0_h0|0_h0+h0|w0_h0+h0`,
  `${out}/sheet.png`,
]);
console.log(`${out}/sheet.png`);
