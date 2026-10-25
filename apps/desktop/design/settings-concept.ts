// Stage 9f concept: the behaviour of the window, so the sequence can be filmed before the port.
import { comboFromEvent, comboLabel } from '../src/keys';
import { leavePage, revealPage, selectRow } from '../src/settings-motion';
import { welcomeMascot } from '../src/welcome-mascot';
import {
  createMascot,
  defaultSettings,
  islandPointerDown,
  islandPointerLeave,
  islandPointerMove,
} from '@almanac-notch/island';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ---------- the daylight (Almanac lib/daylight.ts, dark theme): the same light as Almanac ----------
const ANCHORS: [number, [number, number, number]][] = [
  [3, [28, 34, 58]],
  [6, [61, 41, 33]],
  [9, [61, 41, 33]],
  [13, [53, 38, 32]],
  [17, [61, 41, 33]],
  [21, [61, 41, 33]],
];
function daylight(minutes: number): string {
  const day = 24 * 60;
  let from = ANCHORS[ANCHORS.length - 1]!,
    to = ANCHORS[0]!,
    t = 0;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const a = ANCHORS[i]!,
      b = ANCHORS[i + 1]!;
    if (minutes >= a[0] * 60 && minutes < b[0] * 60) {
      [from, to, t] = [a, b, (minutes - a[0] * 60) / ((b[0] - a[0]) * 60)];
      break;
    }
  }
  if (t === 0 && !(minutes >= ANCHORS[0]![0] * 60 && minutes < ANCHORS[ANCHORS.length - 1]![0] * 60)) {
    const start = from[0] * 60,
      span = day - start + to[0] * 60;
    t = (minutes >= start ? minutes - start : day - start + minutes) / span;
  }
  const c = [0, 1, 2].map((i) => Math.round(from[1][i]! + (to[1][i]! - from[1][i]!) * t));
  return `radial-gradient(120% 60% at 50% -10%, rgb(${c.join(' ')}) 0%, var(--bg) 70%)`;
}
// ?h=23 shows another hour (screenshots of the day)
const hour = new URLSearchParams(location.search).get('h');
const now = new Date();
document.documentElement.style.setProperty(
  '--veil',
  daylight(hour !== null ? +hour * 60 : now.getHours() * 60 + now.getMinutes()),
);

// ---------- pages ----------
const rows = [...document.querySelectorAll<HTMLButtonElement>('.row[data-page]')];
let current: HTMLElement = $('behave');
for (const r of rows)
  r.addEventListener('click', () => {
    for (const x of rows) x.classList.toggle('on', x === r);
    selectRow(r);
    const next = $(r.dataset.page ?? 'behave');
    if (next === current) return;
    const old = current;
    current = next;
    leavePage(old, () => (old.hidden = old !== current));
    next.hidden = false;
    revealPage(next);
    if (next.id === 'behave') demo.restart();
  });

// ---------- Поведение: the real island answers the settings, live ----------
const cap = $('d-cap'),
  cursor = $('d-cursor'),
  hover = $<HTMLInputElement>('o-hover'),
  live = $<HTMLCanvasElement>('d-island');
let closeAfter = 5;
const S = defaultSettings(false);
const m = createMascot({ settings: S, now: performance.now() });
const s = m.state;
// the prototype's sample day: the example looks like a lived-in island, not an empty one
s.bare = false;
s.host = { openOnHover: true, autoClose: closeAfter, status: [], version: '', volume: 0.6 };
s.notchW = 185;
s.mb = 33.5;
s.IW = 680;
s.IH = 230;
const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
live.width = s.IW * dpr;
live.height = s.IH * dpr;
const off = document.createElement('canvas');
off.width = live.width;
off.height = live.height;
const ic = live.getContext('2d') as CanvasRenderingContext2D,
  oc = off.getContext('2d') as CanvasRenderingContext2D;
// no greeting in an example
s.event = null;
s.postLaunchUntil = 0;
/** the example is the window scaled 516 / 680: the cursor is placed in island points */
const K = 516 / 680;
const box = (): DOMRect => live.getBoundingClientRect();
function pointAt(x: number, y: number): void {
  const b = box(),
    host = cursor.parentElement!.getBoundingClientRect();
  cursor.style.left = `${b.left - host.left + x * K}px`;
  cursor.style.top = `${b.top - host.top + y * K}px`;
}
/** a hand moving: the island gets every step, as from a real mouse */
let path: { x: number; y: number; t: number }[] = [];
function glide(x0: number, y0: number, x1: number, y1: number, ms: number, start: number): void {
  for (let i = 0; i <= 20; i++) {
    const k = i / 20,
      e = 1 - (1 - k) ** 3;
    path.push({ x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e, t: start + ms * k });
  }
}
let t0 = performance.now(),
  clickAt = -1,
  loopMs = 0;
function plan(): void {
  path = [];
  s.host!.openOnHover = hover.checked;
  s.host!.autoClose = closeAfter;
  s.clickOpen = false;
  t0 = performance.now();
  cap.textContent = hover.checked
    ? 'Курсор у выреза - остров открывается'
    : 'Курсор у выреза - остров только выглядывает';
  glide(560, 200, 340, 14, 900, 300);
  if (hover.checked) {
    glide(340, 14, 380, 60, 400, 1300);
    glide(380, 60, 120, 215, 700, 3000);
    clickAt = -1;
    loopMs = 5200;
  } else {
    glide(340, 14, 380, 60, 400, 1300);
    clickAt = 2300;
    glide(380, 60, 120, 215, 700, 3200);
    loopMs = 4200 + closeAfter * 1000 + 800;
  }
}
let lastT = performance.now(),
  inside = false,
  clicked = false;
function frame(now: number): void {
  const t = now - t0;
  if (t > loopMs) {
    plan();
    clicked = false;
  }
  // the newest step of the hand not in the future
  let p = path[0];
  for (const q of path) if (q.t <= t) p = q;
  if (p) {
    pointAt(p.x, p.y);
    const isIn = p.x >= 0 && p.y >= 0 && p.x < s.IW && p.y < s.IH && p.y < 200;
    if (isIn) islandPointerMove(s, p, now);
    else if (inside) islandPointerLeave(s);
    inside = isIn;
  }
  if (clickAt >= 0 && !clicked && t >= clickAt && p) {
    clicked = true;
    islandPointerDown(s, p);
    cap.textContent = `Клик - остров открыт и ждёт ${closeAfter} с после ухода курсора`;
  }
  if (hover.checked && t > 3000 && t < 3100) cap.textContent = 'Курсор ушёл - остров закрывается почти сразу';
  m.update(Math.min(0.05, (now - lastT) / 1000), now);
  lastT = now;
  m.renderIsland(ic, oc);
  requestAnimationFrame(frame);
}
plan();
requestAnimationFrame(frame);
const demo = { restart: plan };
hover.addEventListener('change', plan);
for (const b of $('o-close').querySelectorAll('button'))
  b.addEventListener('click', () => {
    for (const x of $('o-close').querySelectorAll('button')) x.classList.toggle('on', x === b);
    closeAfter = parseInt(b.textContent ?? '5', 10);
    plan();
  });

// ---------- Звук: the mascot hears the level ----------
const stage = welcomeMascot($<HTMLCanvasElement>('s-mascot'), 0.6);
stage.setRunning(true);
const vol = $<HTMLInputElement>('s-vol');
vol.addEventListener('input', () => vol.style.setProperty('--v', `${+vol.value * 100}%`));
vol.addEventListener('change', () => stage.poke());
$('s-try').addEventListener('click', () => stage.react('success'));

// ---------- Клавиши: the island's buttons change with the chips ----------
let rec: HTMLButtonElement | null = null;
for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip[data-k]'))
  chip.addEventListener('click', () => {
    rec?.classList.remove('rec');
    rec = chip;
    chip.classList.add('rec');
    chip.textContent = 'Нажмите клавиши…';
  });
document.addEventListener('keydown', (e) => {
  if (!rec) return;
  e.preventDefault();
  const combo = comboFromEvent(e);
  if (e.key !== 'Escape' && !combo) return;
  const kbd = $(rec.dataset.k ?? '');
  if (combo) kbd.textContent = comboLabel(combo, true);
  rec.textContent = kbd.textContent;
  rec.classList.remove('rec');
  rec = null;
  kbd.classList.add('pop');
  window.setTimeout(() => kbd.classList.remove('pop'), 250);
});
