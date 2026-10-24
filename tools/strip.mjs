// Stage 9 filmstrip: the app page on a virtual clock, one action, then the island every 1/60 s.
// node tools/strip.mjs <scene> [out-dir]  - scenes: open, focus, ev-error, ev-attention, focus-back, tab-chat, tab-settings, tab-home,
//   rail-sweep (the pointer down the focus card's mascot stack and back up), autoclose (click-open, leave, fold),
//   almanac-depth (Almanac's list: wheel, into a habit, back)
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
} else if (scene === 'almanac-depth') {
  // Almanac's card on its levels: the list of the day, the wheel down and up, into a habit, back
  await p.evaluate(() => {
    const s = window.__state;
    const h = (id, name, done, count, goal, streak, week) => ({
      id: `00000000-0000-4000-8000-00000000000${id}`, name, done, progress: goal > 1 && !done ? `${count}/${goal}` : '',
      count, goal, streak, week,
    });
    const rows = [
      h(1, 'Зарядка', false, 0, 1, 12, '1111110'),
      h(2, 'Вода', false, 3, 8, 5, '1101110'),
      h(3, 'Читать 20 минут', false, 0, 1, 0, '0010000'),
      h(4, 'Английский', false, 0, 1, 3, '0f01110'),
      h(5, 'Прогулка', false, 0, 1, 1, '1000010'),
      h(6, 'Медитация', true, 1, 1, 9, '1111111'),
      h(7, 'Без сахара', true, 1, 1, 21, '1111111'),
    ];
    s.almanac = { auth: 'ok', rows, done: 2, total: 7, short: 'привычки 2 из 7', hint: ['', ''], note: '' };
  });
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  const pill = await p.evaluate(() => window.__state.hits.find((x) => x.act === 'focus:almanac'));
  await p.mouse.move(pill.x + pill.w / 2, pill.y + pill.h / 2);
  await p.mouse.down();
  await p.mouse.up();
  await p.clock.runFor(1500);
  const zone = await p.evaluate(() => window.__state.hits.find((x) => x.act === 'scroll:almanac'));
  const cx = zone.x + zone.w * 0.6;
  await p.mouse.move(cx, zone.y + 30);
  await shoot();
  for (let i = 0; i < 3; i++) {
    await p.mouse.wheel(0, 100);
    await shoot();
  }
  await p.mouse.wheel(0, 100); // past the end: the list gives a little and springs back
  await shoot();
  for (let i = 0; i < 4; i++) await p.mouse.wheel(0, -100);
  await shoot();
  const row = await p.evaluate(() => window.__state.hits.find((x) => x.act.startsWith('depth:almanac:item:')));
  await p.mouse.move(row.x + row.w * 0.6, row.y + row.h / 2);
  await p.mouse.down();
  await p.mouse.up();
  await shoot();
  await shoot();
  const back = await p.evaluate(() => window.__state.hits.find((x) => x.act === 'depth:back'));
  await p.mouse.move(back.x + 8, back.y + back.h / 2);
  await p.mouse.down();
  await p.mouse.up();
  await shoot();
} else if (scene === 'github-depth') {
  // GitHub's card on its levels: the CI of every repository, a red one inside, back, the PRs
  await p.evaluate(() => {
    const s = window.__state,
      now = s.date().getTime();
    const run = (repo, state, check, mins, title) => ({
      key: repo + '#a1b2c3d', state, repo, branch: 'main', check, sha: 'a1b2c3d', title,
      done: state === 'ok' ? 5 : 3, total: 5, at: now - mins * 60000, rerun: state === 'fail',
    });
    const runs = [
      run('almanac-notch', 'fail', 'build', 4, 'Fan the rail stack open'),
      run('almanac-app', 'ok', '', 26, 'Add habit history'),
      run('portfolio', 'run', '', 2, 'Tune the hero'),
      run('parkovich', 'ok', '', 180, 'Map pins'),
      run('foa', 'ok', '', 1500, 'Bump deps'),
    ];
    const pr = (num, repo, title, author, h, draft = false) => ({
      repo, num, title, author, at: now - h * 3600000, url: `https://github.com/me/${repo}/pull/${num}`, draft,
    });
    s.github = {
      auth: 'ok', ci: 'fail', ciText: 'almanac-notch · упал: build', short: 'CI упал', prs: 4, prText: '',
      commits: [4, 0, 6, 9, 3, 7, 5], hint: ['', ''], runs, fail: runs[0],
      review: [
        pr(31, 'almanac-app', 'Streaks in the integration API', 'ann', 2),
        pr(12, 'portfolio', 'Case study: Grok Bot', 'max', 20),
        pr(7, 'parkovich', 'Offline map tiles', 'lee', 50, true),
        pr(5, 'foa', 'Typo in README', 'kim', 90),
      ],
    };
  });
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  // the red CI was seen already: the card is its summary, not the alert (island/ci.ts)
  await p.evaluate(() => {
    const s = window.__state;
    s.focusId = 'github';
    s.ciSeen = s.ciHidden = s.github.runs[0].key;
  });
  await p.clock.runFor(1500);
  const click = async (act) => {
    const h = await p.evaluate((a) => window.__state.hits.find((x) => x.act === a || x.act.startsWith(a)), act);
    if (!h) throw new Error('no zone ' + act + ' in ' + (await p.evaluate(() => window.__state.hits.map((x) => x.act).join(' '))));
    await p.mouse.move(h.x + h.w * 0.5, h.y + h.h / 2);
    await shoot();
    await p.mouse.down();
    await p.mouse.up();
  };
  await click('depth:github:ci');
  await shoot();
  await click('depth:github:run:almanac-notch');
  await shoot();
  await click('depth:back');
  await shoot();
  await click('depth:back');
  await shoot();
  await click('depth:github:prs');
  await shoot();
  await click('depth:github:pr:');
  await shoot();
} else if (scene === 'cal-depth') {
  // the calendar's card on its levels: the next meeting inside, back, the day's list
  await p.evaluate(() => {
    const s = window.__state,
      now = s.date().getTime();
    const hm = (t) => new Date(t).getHours() + ':' + String(new Date(t).getMinutes()).padStart(2, '0');
    const ev = (i, title, inMin, len, place, link) => ({
      id: `${now + inMin * 60000}:${i}`, title, start: now + inMin * 60000, end: now + (inMin + len) * 60000,
      at: hm(now + inMin * 60000), place, link,
    });
    const events = [
      ev(0, 'Созвон с командой', 4, 30, 'Переговорка «Север»', 'https://meet.google.com/abc-defg-hij'),
      ev(1, 'Ревью дизайна', 70, 45, '', 'https://zoom.us/j/123'),
      ev(2, 'Обед с Аней', 150, 60, 'Кафе на Покровке', ''),
      ev(3, 'Лекция', 260, 90, 'Ауд. 512', ''),
      ev(4, 'Спортзал', 420, 60, '', ''),
    ];
    s.cal = { mins: 4, at: events[0].at, title: events[0].title, after: 'дальше: Ревью дизайна в ' + events[1].at, events };
    s.focusId = 'cal';
  });
  await p.mouse.move(340, 12);
  await p.clock.runFor(1500);
  const click = async (act) => {
    const h = await p.evaluate((a) => window.__state.hits.find((x) => x.act === a || x.act.startsWith(a)), act);
    if (!h) throw new Error('no zone ' + act + ' in ' + (await p.evaluate(() => window.__state.hits.map((x) => x.act).join(' '))));
    await p.mouse.move(h.x + h.w * 0.5, h.y + h.h / 2);
    await shoot();
    await p.mouse.down();
    await p.mouse.up();
  };
  await click('depth:cal:ev:');
  await shoot();
  await click('depth:back');
  await shoot();
  await click('depth:cal:day');
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
