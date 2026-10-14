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
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { AgentDriver, type AgentMsg, type Usage } from './agent';
import { CalDriver, MediaDriver, type Calendar, type MediaMsg } from './feeds';

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

// proto: keydown - the answer keys Y/N and 1-3 (SPEC 2.10). The panel never takes the keyboard
// (it would steal focus), so in the window they are global ⌥Y / ⌥N / ⌥1-3, registered only
// while a prompt is open (docs/CHANGES.md). The browser mode keeps the plain keys.
/** true = the key answered the open prompt */
function answerKey(key: string): boolean {
  const ev = s.event;
  if (!ev || ev.answer || (ev.type !== 'attention' && ev.type !== 'question')) return false;
  if (ev.type === 'attention' && (key === 'y' || key === 'n')) {
    wake();
    m.answer(key === 'y' ? 'approve' : 'deny');
    return true;
  }
  const opts = s.agent?.question?.[1].length ?? 3;
  if (ev.type === 'question' && ['1', '2', '3'].includes(key) && +key <= opts) {
    wake();
    m.answer(`opt:${+key - 1}`);
    return true;
  }
  return false;
}
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (answerKey(e.key.toLowerCase())) e.preventDefault();
});

/** Which global answer keys are registered: none, the approval pair or the options. */
let hotkeys: 'none' | 'attention' | 'question' = 'none';
let hotkeysBusy = false;
async function syncHotkeys(): Promise<void> {
  const ev = s.event;
  const want = ev && !ev.answer && (ev.type === 'attention' || ev.type === 'question') ? ev.type : 'none';
  if (want === hotkeys || hotkeysBusy) return;
  hotkeysBusy = true;
  try {
    await unregisterAll();
    hotkeys = 'none';
    const keys = want === 'attention' ? ['Y', 'N'] : want === 'question' ? ['1', '2', '3'] : [];
    if (keys.length)
      await register(
        keys.map((k) => 'Alt+' + k),
        (e) => {
          if (e.state === 'Pressed') answerKey(e.shortcut.slice(-1).toLowerCase());
        },
      );
    hotkeys = want;
  } catch (err) {
    // another app holds the combination: clicks still work
    console.warn('[hotkeys]', err);
    hotkeys = want;
  } finally {
    hotkeysBusy = false;
  }
}
island.addEventListener('dblclick', (e) => islandDoubleClick(s, domPoint(e)));

// ---------- Claude Code (hooks, plan usage), calendar, music ----------
let agent: AgentDriver | null = null;
let cal: CalDriver | null = null;
let media: MediaDriver | null = null;

interface Feeds {
  calendar: Calendar | null;
  media: MediaMsg | null;
  volume: number | null;
}

async function decodeArt(b64: string): Promise<CanvasImageSource | null> {
  try {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return await createImageBitmap(new Blob([bin], { type: b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg' }));
  } catch {
    return null;
  }
}

// ---------- debug (tray) ----------
const isEvent = (v: string): v is EventType | 'sleep' => v === 'sleep' || EVENT_TYPES.includes(v as EventType);
function debug(id: string): void {
  wake();
  const [kind, v = ''] = id.split(':');
  // tray events demo the prototype's stub data; the next real hook brings live data back
  if (kind === 'ev') s.agent = null;
  if (kind === 'ev' && isEvent(v)) m.trigger(v);
  else if (kind === 'nstate' && ['auto', 'closed', 'half', 'open'].includes(v)) S.nstate = v;
}

if (inTauri) {
  await listen<Geometry>('island://geometry', (e) => applyGeometry(e.payload));
  await listen<IslandPoint | null>('island://cursor', (e) => pointer(e.payload));
  await listen<string>('island://debug', (e) => debug(e.payload));
  agent = new AgentDriver({
    m,
    send: (id, answer) => void invoke('agent_answer', { id, answer }),
    now: Date.now,
  });
  await listen<AgentMsg>('island://agent', (e) => {
    wake();
    agent?.onMessage(e.payload);
  });
  await listen<Usage>('island://usage', (e) => {
    wake();
    agent?.onUsage(e.payload);
  });
  agent.onUsage(await invoke<Usage>('claude_usage'));
  cal = new CalDriver(s, Date.now);
  media = new MediaDriver(s, {
    send: (cmd) => void invoke('media_cmd', { cmd }),
    setVolume: (v) => void invoke('set_volume', { v }),
    decode: decodeArt,
    now: Date.now,
  });
  await listen<Calendar>('island://calendar', (e) => {
    wake();
    cal?.onCalendar(e.payload);
  });
  await listen<MediaMsg>('island://media', (e) => {
    wake();
    media?.onMessage(e.payload);
  });
  await listen<number | null>('island://volume', (e) => {
    wake();
    media?.onVolume(e.payload);
  });
  const f = await invoke<Feeds>('feeds_state');
  if (f.calendar) cal.onCalendar(f.calendar);
  if (f.media) media.onMessage(f.media);
  media.onVolume(f.volume);
  // a reloaded page must not keep the previous page's answer keys
  await unregisterAll();
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
  // island answers go back to the hook; expired prompts, the limit timer, stale sessions
  agent?.tick();
  cal?.tick();
  media?.tick();
  if (inTauri) void syncHotkeys();
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
