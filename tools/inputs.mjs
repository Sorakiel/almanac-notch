#!/usr/bin/env node
// Input parity: drives the prototype and the port with the same pointer and keyboard input under the
// virtual clock, and compares island frames and state after each step. Does not touch reference/.
//
//   node tools/inputs.mjs                  all flows
//   node tools/inputs.mjs --only player    one flow
//
// Clicks target hit zones by their act ('tab:chat', 'm:seek'...), read from each page's own hit list, so a
// zone that moved or vanished shows up as a hit-list difference. Report: .parity/inputs/report.md.
import { chromium } from 'playwright';
import { build, preview } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const outDir = resolve(root, '.parity/inputs');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const open = [{ leave: true }, { wait: 6500 }, { nstate: 'open' }, { wait: 900 }];
const shot = (n, w = 300) => [{ wait: w }, { shot: n }];
export const FLOWS = [
  { name: 'tabs', steps: [...open,
    { click: 'tab:chat' }, ...shot('chat'), { click: 'tab:add' }, ...shot('add'), { click: 'tab:settings' }, ...shot('settings'),
    { click: 'tab:settings' }, ...shot('settings-again'), { click: 'tab:settings' }, ...shot('settings-3'), { click: 'tab:home' }, ...shot('home', 600)] },
  { name: 'focus', steps: [...open,
    ...['github', 'cal', 'almanac', 'music', 'claude'].flatMap((f) => [{ click: 'focus:' + f }, ...shot(f + '-150', 150), ...shot(f, 600)])] },
  { name: 'rail', steps: [...open, { focus: 'music' }, { wait: 600 },
    { hover: [222, 80] }, ...shot('rail-in', 400), { click: 'focus:github' }, ...shot('rail-github', 600),
    { leave: true }, ...shot('rail-out', 500)] },
  { name: 'player', steps: [...open, { focus: 'music' }, { wait: 600 },
    { click: 'm:toggle' }, ...shot('paused'), { wait: 1500 }, { click: 'm:toggle' }, ...shot('playing'),
    { click: 'm:next' }, ...shot('next'), { click: 'm:prev' }, ...shot('prev-track'),
    { wait: 4000 }, { click: 'm:prev' }, ...shot('prev-restart'),
    { click: ['m:seek', 0.25] }, ...shot('seek-25'), { click: ['m:seek', 0.97] }, ...shot('seek-97'),
    { click: ['m:vol', 0.3] }, ...shot('vol-30'), { click: ['m:vol', 0] }, ...shot('vol-0'),
    { click: 'm:shuffle' }, ...shot('shuffle-off'), { click: 'm:repeat' }, ...shot('repeat-on'),
    { click: ['m:seek', 0.995] }, ...shot('end-repeat', 1500), { click: 'm:repeat' }, { click: ['m:seek', 0.995] }, ...shot('end-next', 1500)] },
  { name: 'habits', steps: [...open, { focus: 'almanac' }, { wait: 600 },
    { click: 'habit:0' }, ...shot('uncheck-0'), { click: 'habit:0' }, ...shot('check-0', 200), { click: 'habit:2' }, ...shot('check-2', 400),
    // only three habits are clickable in the prototype; the fifth is ticked directly to reach "all done"
    { code: { proto: 'HABITS[4][1] = true', port: '__notch.peek().habits[4][1] = true' } }, { click: 'habit:2' }, ...shot('uncheck-2'),
    { click: 'habit:2' }, ...shot('all-done-200', 200), ...shot('all-done-1200', 1000), ...shot('all-done-3000', 1800)] },
  { name: 'settings', steps: [...open, { click: 'tab:settings' }, { wait: 300 },
    { click: 'pref:0' }, ...shot('pref-0'), { click: 'pref:2' }, ...shot('pref-2'), { click: 'pref:0' }, ...shot('pref-0-back')] },
  { name: 'mute', steps: [...open, { click: 'mute' }, ...shot('muted'), { click: 'mute' }, ...shot('unmuted')] },
  { name: 'approve-y', steps: [...open, { trigger: 'attention' }, { wait: 1200 }, { key: 'y' },
    ...shot('y-100', 100), ...shot('y-400'), ...shot('y-800', 400), ...shot('y-1600', 800)] },
  { name: 'deny-n', steps: [...open, { trigger: 'attention' }, { wait: 1200 }, { key: 'n' },
    ...shot('n-100', 100), ...shot('n-300', 200), ...shot('n-700', 400), ...shot('n-1500', 800)] },
  { name: 'approve-click', steps: [...open, { trigger: 'attention' }, { wait: 1200 }, { hover: 'approve' }, ...shot('hover', 200),
    { click: 'approve' }, ...shot('click-300'), ...shot('click-1200', 900)] },
  { name: 'deny-click', steps: [...open, { trigger: 'attention' }, { wait: 1200 }, { click: 'deny' }, ...shot('click-200', 200), ...shot('click-900', 700)] },
  { name: 'question', steps: [...open, { trigger: 'question' },
    ...shot('q-150', 150), ...shot('q-300', 150), ...shot('q-450', 150), ...shot('q-700', 250), { wait: 500 },
    { key: '2' }, ...shot('key2-100', 100), ...shot('key2-500', 400), ...shot('key2-1200', 700)] },
  { name: 'question-click', steps: [...open, { trigger: 'question' }, { wait: 1200 }, { hover: 'opt:2' }, ...shot('hover', 200),
    { click: 'opt:2' }, ...shot('click-300'), ...shot('click-1000', 700)] },
  { name: 'half-answers', steps: [{ leave: true }, { wait: 6500 }, { nstate: 'half' }, { trigger: 'question' }, { wait: 1200 }, ...shot('q'),
    { key: '1' }, ...shot('opt0', 300), { trigger: 'attention' }, { wait: 1200 }, { key: 'n' }, ...shot('n', 300)] },
  { name: 'reduced', steps: [{ leave: true }, { wait: 6500 }, { check: '#t-reduced' }, { trigger: 'success' }, ...shot('success-600', 600), { shot: 'success-600-stage', area: 'stage' },
    { trigger: 'dance' }, { wait: 1200 }, { shot: 'dance-stage', area: 'stage' }] },
  { name: 'card-mascot', steps: [...open, { click: 'mascot' }, ...shot('poke', 200), { wait: 1500 }, { dbl: 'mascot' }, ...shot('dbl', 300)] },
];

const SEED = `(() => { let s = 0x2545F491; Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  try { localStorage.clear(); } catch (e) {} })();`;

function protoUrl() {
  const src = readFileSync(join(root, 'prototype/island-prototype.html'), 'utf8');
  const i = src.lastIndexOf('})();');
  const html = src.slice(0, i) + 'window.__proto = (q) => eval(q);\n' + src.slice(i);
  const dir = mkdtempSync(join(tmpdir(), 'notch-proto-'));
  writeFileSync(join(dir, 'index.html'), html);
  return 'file://' + join(dir, 'index.html');
}
const PEEK_PROTO = `({ focusId, tab, muted, volume, trackIdx, musicPos, musicPlaying, shuffle, repeat, habits: HABITS, prefs: PREFS,
  event: event && { type: event.type, label: event.label, answer: event.answer, choice: event.choice }, IW, IH,
  hits: hits.map(h => ({ act: h.act, x: h.x, y: h.y, w: h.w, h: h.h })) })`;
const T = {
  proto: {
    name: 'proto',
    run: (page, q) => page.evaluate((c) => window.__proto(c), q),
    peek: (page) => page.evaluate((c) => JSON.parse(JSON.stringify(window.__proto(c))), PEEK_PROTO),
    nstate: (v) => `S.nstate = ${JSON.stringify(v)}`, trigger: (v) => `trigger(${JSON.stringify(v)})`, focus: (v) => `focusId = ${JSON.stringify(v)}`,
  },
  port: {
    name: 'port',
    run: (page, q) => page.evaluate((c) => (0, eval)(c), q),
    peek: (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__notch.peek()))),
    nstate: (v) => `__notch.setNotchState(${JSON.stringify(v)})`, trigger: (v) => `__notch.trigger(${JSON.stringify(v)})`, focus: (v) => `__notch.setFocus(${JSON.stringify(v)})`,
  },
};

async function runFlow(browser, url, A, flow) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.clock.install({ time: new Date('2026-10-14T10:30:00') });
  await page.clock.pauseAt(new Date('2026-10-14T10:30:00.010'));
  await page.addInitScript(SEED);
  await page.goto(url, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  const shots = [], log = [];
  const at = async (target) => {
    const [act, fx] = Array.isArray(target) ? target : [target, 0.5];
    const st = await A.peek(page);
    const h = [...st.hits].reverse().find((z) => z.act === act);
    if (!h) { log.push(`no hit ${act}`); return null; }
    const b = await page.locator('#island').boundingBox();
    return { x: b.x + (h.x + h.w * fx) * b.width / st.IW, y: b.y + (h.y + h.h / 2) * b.height / st.IH };
  };
  for (const s of flow.steps) {
    if (s.wait) await page.clock.runFor(s.wait);
    else if (s.leave) { await page.mouse.move(4, 896); await page.clock.runFor(16); }
    else if ('nstate' in s || 'trigger' in s || 'focus' in s) { const k = Object.keys(s)[0]; await A.run(page, A[k](s[k])); }
    else if (s.check) { await page.locator(s.check).check({ force: true }); await page.clock.runFor(16); }
    else if (s.code) await A.run(page, s.code[A.name]);
    else if (s.hover) {
      if (Array.isArray(s.hover)) {
        const b = await page.locator('#island').boundingBox();
        await page.mouse.move(b.x + b.width / 2 + s.hover[0], b.y + s.hover[1]);
      } else { const p = await at(s.hover); if (p) await page.mouse.move(p.x, p.y); }
      await page.clock.runFor(16);
    } else if (s.click || s.dbl) {
      const p = await at(s.click || s.dbl);
      if (p) {
        await page.mouse.move(p.x, p.y);
        await page.clock.runFor(16);
        await page.mouse.click(p.x, p.y, s.dbl ? { clickCount: 2 } : {});
      }
      await page.clock.runFor(16);
    } else if (s.key) { await page.keyboard.press(s.key); await page.clock.runFor(16); }
    else if (s.shot) {
      const png = await page.locator(s.area === 'stage' ? '#stage' : '#island').screenshot();
      const st = await A.peek(page);
      st.musicPos = Math.round(st.musicPos * 1000) / 1000;
      const ui = await page.evaluate(() => ['ev', 'ia', 'bg'].map((k) => document.getElementById('V-' + k)?.textContent).join(' | '));
      shots.push({ name: s.shot, png, st, ui, cursor: await page.evaluate(() => getComputedStyle(document.getElementById('island')).cursor) });
    }
  }
  await ctx.close();
  return { shots, log, errs };
}

await build({ root: resolve(root, 'apps/harness'), configFile: resolve(root, 'apps/harness/vite.config.ts'), logLevel: 'warn' });
const server = await preview({ root: resolve(root, 'apps/harness'), configFile: resolve(root, 'apps/harness/vite.config.ts'), preview: { port: 5175, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch();
const rows = [];
let bad = 0;
try {
  for (const flow of FLOWS) {
    if (only && flow.name !== only) continue;
    let a, b;
    try {
      a = await runFlow(browser, protoUrl(), T.proto, flow);
      b = await runFlow(browser, 'http://localhost:5175/harness.html', T.port, flow);
    } catch (e) { rows.push(`| ${flow.name} | - | ${e.message.split('\n')[0]} | ✗ |`); bad++; continue; }
    for (const m of [...a.log.map((x) => 'proto: ' + x), ...b.log.map((x) => 'port: ' + x), ...a.errs.map((x) => 'proto error: ' + x), ...b.errs.map((x) => 'port error: ' + x)]) {
      rows.push(`| ${flow.name} | - | ${m} | ✗ |`); bad++;
    }
    // Known font difference: local Onest 500 vs Google's shifts centred "✓ Разрешено" by a subpixel,
    // 0.10-0.11% from run to run - the same as reference frame open-attention-approved (PARITY).
    const KNOWN = { 'approve-click-click-300': 0.0015 };
    a.shots.forEach((sa, i) => {
      const sb = b.shots[i];
      const pa = PNG.sync.read(sa.png), pb = PNG.sync.read(sb.png);
      const diff = new PNG({ width: pa.width, height: pa.height });
      const n = pa.width === pb.width && pa.height === pb.height ? pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: 0.1 }) : -1;
      const notes = [];
      // text-measured zones differ by hundredths of a px with the local Onest file (see PROGRESS, 2c)
      const near = (x, y) => x.length === y.length && x.every((h, j) => h.act === y[j].act && ['x', 'y', 'w', 'h'].every((k) => Math.abs(h[k] - y[j][k]) < 0.05));
      for (const k of Object.keys(sa.st)) if (k === 'hits' ? !near(sa.st.hits, sb.st.hits) : k === 'musicPos' ? Math.abs(sa.st[k] - sb.st[k]) > 0.01 : JSON.stringify(sa.st[k]) !== JSON.stringify(sb.st[k])) notes.push(k === 'hits' ? 'hits: ' + JSON.stringify(sa.st.hits.filter((h, j) => JSON.stringify(h) !== JSON.stringify(sb.st.hits[j]))) + ' vs ' + JSON.stringify(sb.st.hits.filter((h, j) => JSON.stringify(h) !== JSON.stringify(sa.st.hits[j]))) : `${k}: ${JSON.stringify(sa.st[k])} vs ${JSON.stringify(sb.st[k])}`);
      if (sa.ui !== sb.ui) notes.push(`layers: ${sa.ui} vs ${sb.ui}`);
      if (sa.cursor !== sb.cursor) notes.push(`cursor: ${sa.cursor} vs ${sb.cursor}`);
      const share = n < 0 ? 1 : n / (pa.width * pa.height);
      const id = `${flow.name}-${sa.name}`;
      const ok = share <= (KNOWN[id] ?? 0.001) && !notes.length;
      if (!ok) bad++;
      writeFileSync(join(outDir, id + '.proto.png'), sa.png);
      writeFileSync(join(outDir, id + '.port.png'), sb.png);
      if (n > 0) writeFileSync(join(outDir, id + '.diff.png'), PNG.sync.write(diff));
      rows.push(`| ${flow.name} | ${sa.name} | ${n < 0 ? 'size' : `${n} px (${(share * 100).toFixed(2)}%)`}${notes.length ? '; ' + notes.join('; ') : ''} | ${ok ? '✓' : '✗'} |`);
    });
    console.log('flow', flow.name);
  }
} finally {
  await browser.close();
  await server.close();
}
const report = `# Сверка ввода\n\nПорог: 0.10% пикселей и совпадение состояния. Не прошло: ${bad}.\n\n| поток | кадр | отличие | итог |\n|---|---|---|---|\n${rows.join('\n')}\n`;
writeFileSync(join(outDir, 'report.md'), report);
console.log(report);
process.exit(bad ? 1 : 0);
