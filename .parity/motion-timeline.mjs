// Stage 9b: open / close of the app island frame by frame from the page (virtual clock, 1/120 s):
// island springs (ih, nw, ears) and content fades (openA, halfA), to compare with coucou.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 560, height: 200 }, deviceScaleFactor: 2 });
await p.clock.install();
await p.goto('http://127.0.0.1:1420/');
await p.clock.runFor(3000);
await p.evaluate(() => {
  const s = window.__state;
  s.event = null;
  s.postLaunchUntil = 0;
  s.host.openOnHover = true;
});
await p.mouse.move(5, 195);
await p.clock.runFor(2000);
const rows = ['phase,t,ih,nw,earR,openA,halfA'];
async function rec(phase, n) {
  const t0 = await p.evaluate(() => window.__state.t);
  for (let i = 0; i < n; i++) {
    await p.clock.runFor(1000 / 120);
    const r = await p.evaluate(() => {
      const s = window.__state;
      return [s.t, s.sp.ih.x, s.sp.nw.x, s.sp.earR.x, s.sp.openA.x, s.sp.halfA.x];
    });
    r[0] -= t0;
    rows.push([phase, ...r.map((v) => v.toFixed(4))].join(','));
  }
}
await p.mouse.move(280, 12);
await rec('open', 120);
await p.mouse.move(5, 199);
await p.evaluate(() => window.dispatchEvent(new Event('blur')));
await rec('close', 120);
writeFileSync('.parity/motion-timeline.csv', rows.join('\n'));
await b.close();
