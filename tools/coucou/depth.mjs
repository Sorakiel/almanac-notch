// coucou's card depth on its own clock: the GitHub card -> "My PRs" list -> wheel scroll -> back.
// Needs the coucou web dev server (README.md, port 5288). OUT=.parity/strip node tools/coucou/depth.mjs
// Frames every 1/60 s in <OUT>/cc-depth/, a contact sheet and a 60 fps mp4 beside them.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = process.env.OUT ?? '.parity/strip',
  dir = `${out}/cc-depth`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 720, height: 260 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 160)));
await p.clock.install({ time: 0 });
await p.clock.pauseAt(1000);
await p.goto('http://127.0.0.1:5288/dev/tabs-preview.html');
await p.clock.runFor(2000);

// a GitHub pill with a pulse of 8 PRs, so the list is longer than its three visible rows
await p.evaluate(() => {
  const S = window.State;
  const pr = (n, ci) => ({
    id: `me/app#${n}`, title: `Change number ${n} of the app`, url: `https://github.com/me/app/pull/${n}`,
    repo: 'me/app', number: n, isDraft: false, ci, review: 'none', headSha: null,
  });
  if (!S.tasks.some((t) => t.id === 'integration_github')) {
    const base = S.tasks[0];
    S.tasks.push({ ...base, id: 'integration_github', name: 'GitHub', color: '#F4505E', steps: [], state: 'idle' });
  }
  S.integrations.integration_github = {
    loaded: true, error: null, configured: true,
    data: {
      totalRepos: 12, totalStars: 40,
      pulse: {
        login: 'me', fetchedAt: Date.now(),
        myPRs: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => pr(n, n === 2 ? 'failure' : 'success')),
        toReview: [pr(11, 'success')],
        mainCI: [{ repo: 'me/app', url: 'https://github.com/me/app', branch: 'main', ci: 'success', headSha: null }],
      },
    },
  };
  S.setFocus('integration_github');
  window.island.expand('overview');
});
await p.clock.runFor(2000);

let frame = 0;
async function shoot(n) {
  for (let i = 0; i < n; i++) {
    await p.screenshot({ path: `${dir}/${String(frame++).padStart(3, '0')}.png`, clip: { x: 0, y: 0, width: 720, height: 230 } });
    await p.clock.runFor(1000 / 60);
  }
}
const row = await p.evaluate(() => {
  const el = document.querySelector('.gh-stat');
  const r = el?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
if (!row) throw new Error('no GitHub stat row: the card did not render');
await p.mouse.move(row.x, row.y);
await shoot(4);
await p.mouse.click(row.x, row.y);
await shoot(24);
// three wheel notches down, then back up, as a hand on a mouse would
const list = await p.evaluate(() => {
  const r = document.querySelector('.gh-list')?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
if (list) {
  await p.mouse.move(list.x, list.y);
  for (let i = 0; i < 3; i++) {
    await p.mouse.wheel(0, 40);
    await shoot(6);
  }
  await shoot(18);
}
const back = await p.evaluate(() => {
  const r = document.querySelector('.gh-back')?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
if (back) {
  await p.mouse.click(back.x, back.y);
  await shoot(24);
}
await b.close();
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '60', '-i', `${dir}/%03d.png`, '-vf', `scale=480:-1,pad=iw+4:ih+4:2:2:white,tile=6x${Math.ceil(frame / 6)}`, '-frames:v', '1', `${out}/cc-depth.png`]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '60', '-i', `${dir}/%03d.png`, '-pix_fmt', 'yuv420p', `${out}/cc-depth.mp4`]);
console.log(`${out}/cc-depth.png`, frame);
