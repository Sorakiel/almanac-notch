#!/usr/bin/env node
// Renders the reference scenes from tools/scenes.mjs.
//
//   node tools/snapshot.mjs                         prototype -> reference/screens
//   node tools/snapshot.mjs --target port --url http://localhost:5173/harness.html --out .parity/port
//   node tools/snapshot.mjs --clips                 prototype -> reference/video (real time, mp4 via ffmpeg)
//   node tools/snapshot.mjs --only open-focus-music
//
// Screens use a virtual clock (page.clock) and a seeded Math.random, so the same scene renders the same
// frame on every run. That is what makes prototype and port comparable (see tools/compare.mjs).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SCENES, CLIPS } from './scenes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const target = opt('target', 'proto');
const only = opt('only', null);
const clips = args.includes('--clips');
const out = resolve(root, opt('out', clips ? 'reference/video' : target === 'proto' ? 'reference/screens' : '.parity/port'));
mkdirSync(out, { recursive: true });

// The prototype keeps everything inside one closure; a debug hook is injected into a temporary copy.
function protoUrl() {
  const src = readFileSync(join(root, 'prototype/island-prototype.html'), 'utf8');
  const i = src.lastIndexOf('})();');
  const html = src.slice(0, i) + 'window.__proto = (q) => eval(q);\n' + src.slice(i);
  const dir = mkdtempSync(join(tmpdir(), 'notch-proto-'));
  writeFileSync(join(dir, 'index.html'), html);
  return 'file://' + join(dir, 'index.html');
}
const url = target === 'proto' ? protoUrl() : opt('url', 'http://localhost:5173/harness.html');

// One adapter per target: the prototype is driven through its own globals, the port through window.__notch.
const adapters = {
  proto: {
    screen: (v) => `S.screen = ${JSON.stringify(v)}`,
    nstate: (v) => `S.nstate = ${JSON.stringify(v)}`,
    trigger: (v) => `trigger(${JSON.stringify(v)})`,
    focus: (v) => `focusId = ${JSON.stringify(v)}`,
    tab: (v) => `tab = ${JSON.stringify(v)}`,
    pokes: (n) => `for (let i = 0; i < ${n}; i++) poke(0.2, -0.3)`,
    answer: (v) => `answer(${JSON.stringify(v)})`,
    tick: (i) => `HABITS[${i}][1] = true`,
    hits: () => `({ IW, IH, hits: hits.map(h => ({ act: h.act, x: h.x, y: h.y, w: h.w, h: h.h })) })`,
    run: (page, code) => page.evaluate((q) => window.__proto(q), code)
  },
  port: {
    screen: (v) => `__notch.setScreen(${JSON.stringify(v)})`,
    nstate: (v) => `__notch.setNotchState(${JSON.stringify(v)})`,
    trigger: (v) => `__notch.trigger(${JSON.stringify(v)})`,
    focus: (v) => `__notch.setFocus(${JSON.stringify(v)})`,
    tab: (v) => `__notch.setTab(${JSON.stringify(v)})`,
    pokes: (n) => `__notch.poke(${n})`,
    answer: (v) => `__notch.answer(${JSON.stringify(v)})`,
    tick: (i) => `__notch.peek().habits[${i}][1] = true`,
    hits: () => `(({ IW, IH, hits }) => ({ IW, IH, hits }))(__notch.peek())`,
    run: (page, code) => page.evaluate((q) => JSON.parse(JSON.stringify((0, eval)(q) ?? null)), code)
  }
};
const A = adapters[target];

const SEED = `(() => { let s = 0x2545F491; Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  try { localStorage.clear(); } catch (e) {} })();`;

async function act(page, step, virtual) {
  const advance = (ms) => virtual ? page.clock.runFor(ms) : page.waitForTimeout(ms);
  if (step.wait) return advance(step.wait);
  for (const k of ['screen', 'nstate', 'trigger', 'focus', 'tab', 'pokes', 'answer', 'tick']) if (k in step) return A.run(page, A[k](step[k]));
  if (step.key) { await page.keyboard.press(step.key); return advance(16); }
  if (step.click || step.dbl || step.point) {
    // a hit zone by its act, read from the page's own hit list; [act, fx] picks a spot along its width
    const [act, fx] = Array.isArray(step.click || step.dbl || step.point) ? (step.click || step.dbl || step.point) : [step.click || step.dbl || step.point, 0.5];
    const st = await A.run(page, A.hits());
    const h = [...st.hits].reverse().find((z) => z.act === act);
    if (!h) throw new Error('no hit zone ' + act);
    const b = await page.locator('#island').boundingBox();
    const x = b.x + (h.x + h.w * fx) * b.width / st.IW, y = b.y + (h.y + h.h / 2) * b.height / st.IH;
    await page.mouse.move(x, y);
    await advance(16);
    if (step.click) await page.mouse.click(x, y);
    if (step.dbl) await page.mouse.click(x, y, { clickCount: 2 });
    return advance(16);
  }
  if (step.hover) {
    const b = await page.locator('#island').boundingBox();
    await page.mouse.move(b.x + b.width / 2 + step.hover[0], b.y + step.hover[1]);
    return advance(16);
  }
  if (step.leave) { const v = page.viewportSize(); await page.mouse.move(4, v.height - 4); return advance(16); }
  if (step.shot) {
    const file = join(out, step.shot + '.png');
    if (step.area === 'page') return page.screenshot({ path: file });
    const sel = { island: '#island', stage: '#stage', loupe: '#loupe' }[step.area || 'island'];
    await page.locator(sel).scrollIntoViewIfNeeded();
    return page.locator(sel).screenshot({ path: file });
  }
}

const browser = await chromium.launch();
if (!clips) {
  for (const sc of SCENES) {
    if (only && sc.name !== only) continue;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'ru-RU' });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    // the clock stands still until the scene advances it, so page load time never leaks into the frame
    await page.clock.install({ time: new Date('2026-10-14T10:30:00') });
    await page.clock.pauseAt(new Date('2026-10-14T10:30:00.010'));
    await page.addInitScript(SEED);
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    for (const st of sc.steps) await act(page, st, true);
    if (errs.length) console.error(sc.name, 'page errors:', errs);
    console.log('scene', sc.name);
    await ctx.close();
  }
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'notch-clips-'));
  for (const cl of CLIPS) {
    if (only && cl.name !== only) continue;
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1,
      recordVideo: { dir: tmp, size: { width: 1180, height: 760 } }, colorScheme: 'light', locale: 'ru-RU' });
    const page = await ctx.newPage();
    await page.addInitScript(SEED);
    await page.goto(url);
    const box = await page.locator('section.notch').boundingBox();
    for (const st of cl.steps) await act(page, st, false);
    const video = page.video();
    await ctx.close();
    const raw = await video.path();
    const dst = join(out, cl.name + '.mp4');
    // the screencast is 1x: crop to the notch preview section, upscale 2x for viewing, encode for QuickTime
    const crop = `crop=${Math.round(box.width)}:${Math.round(box.height)}:${Math.round(box.x)}:${Math.round(box.y)}`;
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', crop + ',scale=trunc(iw*2/2)*2:trunc(ih*2/2)*2:flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', dst]);
    } catch (e) { renameSync(raw, dst.replace(/\.mp4$/, '.webm')); }
    console.log('clip', cl.name);
  }
  rmSync(tmp, { recursive: true, force: true });
}
await browser.close();
