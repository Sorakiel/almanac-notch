// The island in the real window: packages/island drawn over the whole (transparent) window.
// Rust streams the global cursor; the island decides from islandRect() and its hit zones
// whether the window takes the mouse, so clicks anywhere else fall through.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/600.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  EVENT_TYPES,
  createMascot,
  defaultSettings,
  hitTest,
  islandDoubleClick,
  islandPointerDown,
  islandPointerLeave,
  islandPointerMove,
  islandRect,
  notchState,
  type EventType,
  type IslandPoint,
} from '@almanac-notch/island';

interface Geometry {
  hasNotch: boolean;
  notchW: number;
  notchH: number;
  winW: number;
  winH: number;
}

// Outside Tauri (plain browser on the Vite port) the page runs on DOM pointer events, for quick looks.
const inTauri = '__TAURI_INTERNALS__' in window;

for (const f of [
  '400 12px Onest',
  '500 12px Onest',
  '600 12px Onest',
  '400 12px "JetBrains Mono"',
  '500 12px "JetBrains Mono"',
  '500 12px Unbounded',
  '600 12px Unbounded',
])
  void document.fonts.load(f);
await document.fonts.ready;

const S = defaultSettings(matchMedia('(prefers-reduced-motion: reduce)').matches);
const m = createMascot({ settings: S, now: performance.now() });
const s = m.state;
s.bare = true;

const island = document.getElementById('island') as HTMLCanvasElement,
  ic = island.getContext('2d') as CanvasRenderingContext2D;
const off = document.createElement('canvas'),
  oc = off.getContext('2d') as CanvasRenderingContext2D;

let geo: Geometry = { hasNotch: true, notchW: 190, notchH: 32, winW: 560, winH: 200 };
let dpr = 1;

// proto: resize (island part)
function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  s.IW = geo.winW;
  s.IH = geo.winH;
  island.width = Math.round(s.IW * dpr);
  island.height = Math.round(s.IH * dpr);
  off.width = Math.round(s.IW * 2);
  off.height = Math.round(s.IH * 2);
}

function applyGeometry(g: Geometry): void {
  geo = g;
  // No notch (Windows, external displays): the flat tile of the prototype's Windows mode.
  S.screen = g.hasNotch ? 'mac' : 'win';
  s.notchW = g.notchW;
  s.mb = g.hasNotch ? g.notchH : 32;
  resize();
}

// ---------- pointer ----------
let ptr: IslandPoint | null = null;
let interactive = false;
// frame loop state; declared early because listeners may fire before the loop starts
let last = performance.now();
let loop = 0;
let idle = false;

function setInteractive(on: boolean): void {
  if (on === interactive) return;
  interactive = on;
  if (inTauri) void invoke('set_interactive', { on });
}

/** The window takes the mouse only over the strip or a clickable zone (e.g. the mascot). */
function updateInteractive(): void {
  if (!ptr) return setInteractive(false);
  const r = islandRect(s);
  const inRect = ptr.x >= r.x && ptr.x <= r.x + r.w && ptr.y >= r.y && ptr.y <= r.y + r.h;
  setInteractive(inRect || hitTest(s, ptr) !== null);
}

/** proto: island pointermove / pointerleave - the window is the prototype's island canvas */
function pointer(p: IslandPoint | null): void {
  wake();
  const inside = !!p && p.x >= 0 && p.y >= 0 && p.x < s.IW && p.y < s.IH;
  if (inside && p) {
    ptr = p;
    island.style.cursor = islandPointerMove(s, p, performance.now());
  } else if (ptr) {
    ptr = null;
    islandPointerLeave(s);
  }
  updateInteractive();
}

const domPoint = (e: MouseEvent): IslandPoint => {
  const r = island.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * s.IW) / r.width, y: ((e.clientY - r.top) * s.IH) / r.height };
};
island.addEventListener('pointerdown', (e) => islandPointerDown(s, domPoint(e)));
island.addEventListener('dblclick', (e) => islandDoubleClick(s, domPoint(e)));

// ---------- debug (tray) ----------
const isEvent = (v: string): v is EventType | 'sleep' => v === 'sleep' || EVENT_TYPES.includes(v as EventType);
function debug(id: string): void {
  wake();
  const [kind, v = ''] = id.split(':');
  if (kind === 'ev' && isEvent(v)) m.trigger(v);
  else if (kind === 'nstate' && ['auto', 'closed', 'half', 'open'].includes(v)) S.nstate = v;
}

if (inTauri) {
  await listen<Geometry>('island://geometry', (e) => applyGeometry(e.payload));
  await listen<IslandPoint | null>('island://cursor', (e) => pointer(e.payload));
  await listen<string>('island://debug', (e) => debug(e.payload));
  applyGeometry(await invoke<Geometry>('island_geometry'));
  // a reloaded page must not inherit a mouse-taking window from the previous one
  await invoke('set_interactive', { on: false });
} else {
  applyGeometry(geo);
  island.addEventListener('pointermove', (e) => pointer(domPoint(e)));
  island.addEventListener('pointerleave', () => pointer(null));
  Object.assign(window, { __debug: debug, __state: s });
}
window.addEventListener('resize', resize);

// ---------- frame loop (proto: frame) ----------
// Idle = closed, settled, no event, cursor away. Then the sim keeps ticking on a 10 Hz timer
// (in 0.05 s steps, the prototype's dt cap) and the hidden strip is not redrawn, so the
// window costs next to nothing. Any cursor move, tray item or state change brings rAF back.
const IDLE_PERIOD = 100;

function isIdle(): boolean {
  const sp = s.sp;
  return (
    !ptr &&
    !s.event &&
    notchState(s) === 'closed' &&
    sp.halfA.x < 0.01 &&
    sp.openA.x < 0.01 &&
    Math.max(sp.earL.x, sp.earR.x) < 0.5 &&
    Math.abs(sp.ih.x - sp.ih.t) < 0.3 &&
    Math.abs(sp.nw.x - sp.nw.t) < 0.3
  );
}

function draw(): void {
  m.renderIsland(ic, oc);
  // SPEC: closed on a notch = only the camera notch. Clear the strip so no black box shows
  // during Space switches (stage 1 remark); it sits under the notch anyway. Glows around it stay.
  const sp = s.sp;
  if (S.screen === 'mac' && sp.halfA.x < 0.01 && sp.openA.x < 0.01 && Math.max(sp.earL.x, sp.earR.x) < 0.5) {
    const b = s.islandBox;
    ic.clearRect((b.x0 - 6) * dpr, 0, (b.x1 - b.x0 + 12) * dpr, b.y1 * dpr);
  }
}

function tick(now: number, id: number): void {
  if (id !== loop) return;
  let dt = (now - last) / 1000;
  last = now;
  if (!idle) dt = Math.min(dt, 0.05);
  // proto: frame - one update per frame, dt capped at 0.05 s
  do {
    const step = Math.min(dt, 0.05);
    m.update(step * S.timeScale, now);
    dt -= step;
  } while (dt > 1e-6);
  idle = isIdle();
  if (!idle || S.screen !== 'mac') draw();
  // The island moves under a still cursor (opens, closes): re-check the click-through zone.
  updateInteractive();
  if (idle) setTimeout(() => tick(performance.now(), id), IDLE_PERIOD);
  else requestAnimationFrame((t) => tick(t, id));
}

/** Leave idle now (cursor, tray); a no-op while frames are running. */
function wake(): void {
  if (!idle) return;
  idle = false;
  loop += 1;
  const id = loop;
  requestAnimationFrame((t) => tick(t, id));
}
requestAnimationFrame((t) => tick(t, loop));
