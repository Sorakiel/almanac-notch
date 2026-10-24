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
  AUTO_CLOSE_DEFAULT,
  EVENT_TYPES,
  autoCloseFrom,
  createMascot,
  defaultSettings,
  hitTest,
  islandDoubleClick,
  islandPointerDown,
  islandPointerUp,
  islandPointerLeave,
  islandBack,
  islandWheel,
  islandPointerMove,
  islandRect,
  notchState,
  tr,
  type EventType,
  type HostPrefs,
  type IslandPoint,
  type ModuleId,
} from '@almanac-notch/island';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { AgentDriver, type AgentMsg, type Usage } from './agent';
import {
  ALL_TIERS,
  DEFAULT_VOLUME,
  moodGain,
  SOUND_NAMES,
  SoundPlayer,
  SoundWatch,
  type SoundMood,
  type Tier,
} from './sound';
import {
  CalDriver,
  GithubDriver,
  MediaDriver,
  VercelDriver,
  NotionDriver,
  GrafanaDriver,
  AlmanacDriver,
  type Calendar,
  type GhState,
  type MediaMsg,
  type VcState,
  type NoState,
  type GfState,
  type AlState,
  type Dot,
} from './feeds';

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
// Live events keep the open tab and card; only the ones that need an answer bring the island
// home to their card (CHANGES 2026-10-18: statuses on every tool call threw the user out of settings).
{
  const raw = m.trigger;
  m.trigger = (type, opts) => raw(type, opts ?? { keepView: type !== 'attention' && type !== 'question' });
}
s.bare = true;
s.settingsLink = true;
// the settings tab is the app's own card, after coucou's (stage 8g, docs/CHANGES.md); its
// choices are this window's own, kept in its storage
const CARD_KEY = 'almanac-notch.card';
s.host = { openOnHover: true, autoClose: AUTO_CLOSE_DEFAULT, status: [], version: '', volume: DEFAULT_VOLUME };
try {
  const saved = JSON.parse(localStorage.getItem(CARD_KEY) ?? '{}') as Partial<HostPrefs> & { sound?: boolean };
  if (typeof saved.openOnHover === 'boolean') s.host.openOnHover = saved.openOnHover;
  // 10/15/30 s until 2026-10-24: a saved 15 or 30 becomes 10
  s.host.autoClose = autoCloseFrom(saved.autoClose);
  if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) s.host.volume = saved.volume;
  if (typeof saved.sound === 'boolean') s.muted = !saved.sound;
} catch {
  // unreadable storage: defaults
}
/** the CI card's "Перезапустить": the note under the lead line says how it went (island/ci.ts) */
function rerunCi(repo: string): void {
  const run = s.github?.runs.find((r) => r.repo === repo);
  if (!run) return;
  const note = (text: string, err = false): void => {
    s.ciNote = { key: run.key, text: tr(s, text), at: s.t, err };
  };
  note('Перезапускаю…');
  invoke('github_rerun', { name: repo }).then(
    () => note('Перезапустил - жду результат'),
    // the error is already in the interface language (src-tauri github.rs)
    (e: unknown) => {
      s.ciNote = { key: run.key, text: String(e), at: s.t, err: true };
    },
  );
}

function saveCard(): void {
  if (!s.host) return;
  try {
    localStorage.setItem(
      CARD_KEY,
      JSON.stringify({
        openOnHover: s.host.openOnHover,
        autoClose: s.host.autoClose,
        sound: !s.muted,
        volume: s.host.volume,
      }),
    );
  } catch {
    // not saved: the choice holds until restart
  }
}

/** a full-screen app is in front and the island is hidden (src-tauri platform, `fullscreen_tick`) */
let fullscreen = false;

// sounds (stage 9a): on by default and quiet; the speaker and the card's switch turn them off
const player = new SoundPlayer(),
  sounds = new SoundWatch();
player.setVolume(s.host.volume);
if (!s.muted) player.preload();
/** what the island did this frame that sounds - checked every frame so a muted event never
 *  sounds late after unmuting */
function playSounds(): void {
  const { play, stop } = sounds.step(s),
    clicks = sounds.takeClicks(s.t);
  for (const n of stop) player.fadeOut(n);
  // hidden behind a full-screen game or film: the island keeps quiet (owner, 2026-10-24); the
  // frame's sounds are still taken, so nothing plays late when it comes back
  if (s.muted || !s.host || fullscreen) return;
  player.setVolume(s.host.volume);
  pollQuiet();
  const mood: SoundMood = {
    muted: s.muted,
    tiers: soundTiers,
    quiet: callQuiet,
    music: !!s.media && !s.media.idle && s.musicPlaying,
    hour: new Date().getHours(),
  };
  for (const n of [...play, ...clicks]) player.play(n, moodGain(n, mood));
}

// the settings window's three switches (events, mascot, island and buttons): kept in the storage
// both windows share; a change there reaches this window through the "storage" event
const TIERS_KEY = 'almanac-notch.sound-tiers';
let soundTiers: Record<Tier, boolean> = { ...ALL_TIERS };
function readTiers(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(TIERS_KEY) ?? '{}') as Partial<Record<Tier, unknown>>;
    soundTiers = { ...ALL_TIERS };
    for (const k of Object.keys(ALL_TIERS) as Tier[]) if (typeof saved[k] === 'boolean') soundTiers[k] = saved[k];
  } catch {
    // unreadable: every tier on
  }
}
readTiers();
// how CI results reach the person (the settings window, GitHub; island/ci.ts)
const CI_KEY = 'almanac-notch.ci';
function readCi(): void {
  try {
    const v = JSON.parse(localStorage.getItem(CI_KEY) ?? '{}') as Record<string, unknown>;
    s.ciNotify = {
      ok: v.ok === 'off' ? 'off' : 'pop',
      fail: v.fail === 'off' || v.fail === 'dot' ? v.fail : 'pop',
    };
  } catch {
    // unreadable: both pop up
  }
}
readCi();
window.addEventListener('storage', (e) => {
  if (e.key === TIERS_KEY) readTiers();
  if (e.key === CI_KEY) readCi();
});

// a call: asked from the app every few seconds, only while sound is on (src-tauri sound.rs)
let callQuiet = false,
  quietAsked = 0;
function pollQuiet(): void {
  const now = performance.now();
  if (!inTauri || now - quietAsked < 3000) return;
  quietAsked = now;
  void invoke<boolean>('sound_quiet')
    .then((q) => (callQuiet = q))
    .catch(() => (callQuiet = false));
}
/** a sample at the chosen level: after the slider, and when sound is switched on; switching it
 *  off silences what is still playing (the greeting is long) */
function previewSound(): void {
  if (!s.host) return;
  if (s.muted) {
    for (const n of SOUND_NAMES) player.fadeOut(n, 0.1);
    return;
  }
  player.setVolume(s.host.volume);
  player.play('attention');
}
s.iconSet = 'solid';

const island = document.getElementById('island') as HTMLCanvasElement,
  ic = island.getContext('2d') as CanvasRenderingContext2D;
const off = document.createElement('canvas'),
  oc = off.getContext('2d') as CanvasRenderingContext2D;

let geo: Geometry = { hasNotch: true, notchW: 190, notchH: 32, winW: 680, winH: 230 };
let dpr = 1;

// proto: resize (island part)
function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  s.IW = geo.winW;
  s.IH = geo.winH;
  island.width = Math.round(s.IW * dpr);
  island.height = Math.round(s.IH * dpr);
  // drawn at the screen's own density: a fixed 2x scaled down to 1.25 or 1.5 blurs (Windows)
  off.width = Math.round(s.IW * dpr);
  off.height = Math.round(s.IH * dpr);
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
island.addEventListener('pointerdown', (e) => {
  // the mouse's back button: one level back inside a card (island/depth.ts)
  if (e.button === 3) {
    if (islandBack(s)) wake();
    return;
  }
  const p = domPoint(e),
    act = hitTest(s, p);
  // the control's sound depends on its state before the click (a habit ticked or unticked)
  if (act) sounds.click(s, act);
  islandPointerDown(s, p);
  // the volume slider keeps following the pointer outside its zone until release
  if (s.host?.volDrag) island.setPointerCapture(e.pointerId);
});
island.addEventListener('pointerup', () => islandPointerUp(s));
// the wheel and the trackpad: lists inside cards scroll, a swipe to the right goes back
island.addEventListener(
  'wheel',
  (e) => {
    const k = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 200 : 1;
    if (islandWheel(s, domPoint(e), e.deltaX * k, e.deltaY * k)) {
      e.preventDefault();
      wake();
    }
  },
  { passive: false },
);
island.addEventListener('pointercancel', () => islandPointerUp(s));

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
  // Esc steps back out of a card's level (the browser mode: the panel never takes the keyboard)
  else if (e.key === 'Escape' && islandBack(s)) {
    e.preventDefault();
    wake();
  }
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
island.addEventListener('dblclick', (e) => {
  const p = domPoint(e);
  if (hitTest(s, p) === 'mascot') sounds.joy();
  islandDoubleClick(s, p);
});

// ---------- Claude Code (hooks, plan usage), calendar, music ----------
let agent: AgentDriver | null = null;
let cal: CalDriver | null = null;
let media: MediaDriver | null = null;
let github: GithubDriver | null = null;
let vercel: VercelDriver | null = null;
let notion: NotionDriver | null = null;
let grafana: GrafanaDriver | null = null;
let almanac: AlmanacDriver | null = null;

interface Feeds {
  calendar: Calendar | null;
  media: MediaMsg | null;
  volume: number | null;
  github: GhState | null;
  vercel: VcState | null;
  notion: NoState | null;
  grafana: GfState | null;
  almanac: AlState | null;
}

async function decodeArt(b64: string): Promise<CanvasImageSource | null> {
  try {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return await createImageBitmap(new Blob([bin], { type: b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg' }));
  } catch {
    return null;
  }
}

const MODULE_IDS: ModuleId[] = ['claude', 'cal', 'music', 'github', 'almanac', 'vercel', 'notion', 'grafana'];

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
  await listen<boolean>('island://fullscreen', (e) => {
    fullscreen = e.payload;
    if (fullscreen) for (const n of SOUND_NAMES) player.fadeOut(n, 0.1);
    agent?.setHidden(fullscreen);
  });
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
  github = new GithubDriver(s, m, Date.now);
  await listen<GhState>('island://github', (e) => {
    wake();
    github?.onState(e.payload);
  });
  vercel = new VercelDriver(s, m, Date.now);
  await listen<VcState>('island://vercel', (e) => {
    wake();
    vercel?.onState(e.payload);
  });
  notion = new NotionDriver(s, m, Date.now);
  await listen<NoState>('island://notion', (e) => {
    wake();
    notion?.onState(e.payload);
  });
  grafana = new GrafanaDriver(s, m, Date.now);
  await listen<GfState>('island://grafana', (e) => {
    wake();
    grafana?.onState(e.payload);
  });
  // a build without Almanac's address keeps the prototype's stub habits
  if (await invoke<boolean>('almanac_available'))
    almanac = new AlmanacDriver(s, m, Date.now, (id) => invoke('almanac_toggle', { id }));
  await listen<AlState>('island://almanac', (e) => {
    wake();
    almanac?.onState(e.payload);
  });
  // modules switched off in settings and the chat tab (stage 7)
  const applyModules = (c: { off: string[]; chat: boolean }): void => {
    s.off = c.off.filter((id): id is ModuleId => MODULE_IDS.includes(id as ModuleId));
    s.chatOff = !c.chat;
    if (s.chatOff && s.tab === 'chat') s.tab = 'home';
  };
  await listen<{ off: string[]; chat: boolean }>('island://modules', (e) => {
    wake();
    applyModules(e.payload);
  });
  applyModules(await invoke('modules_get'));
  // interface language (stage 8): the island translates itself through tr(s, ...)
  const applyLang = (c: { lang: string }): void => {
    s.lang = c.lang === 'en' ? 'en' : 'ru';
  };
  await listen<{ lang: string }>('island://lang', (e) => {
    wake();
    applyLang(e.payload);
  });
  applyLang(await invoke('lang_get'));
  if (s.host) s.host.version = (await invoke<{ version: string }>('app_info')).version;
  const f = await invoke<Feeds>('feeds_state');
  if (f.github) github.onState(f.github);
  if (f.vercel) vercel.onState(f.vercel);
  if (f.notion) notion.onState(f.notion);
  if (f.grafana) grafana.onState(f.grafana);
  if (f.almanac) almanac?.onState(f.almanac);
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
// a display-scale change keeps the window's CSS size, so 'resize' may not fire: watch the density itself
const watchDpr = (): void => {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      resize();
      watchDpr();
    },
    { once: true },
  );
};
watchDpr();

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
  if (!shown) {
    shown = true;
    // The window stays hidden until the page has drawn (on Windows WebView2 shows a white box
    // before that): wait for the fonts, so the first text is not a fallback, and for one frame
    // to reach the screen, then let the host show it (island_ready, platform/windows.rs).
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => inTauri && void invoke('island_ready'))),
    );
  }
}
let shown = false;

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
  github?.tick();
  vercel?.tick();
  notion?.tick();
  grafana?.tick();
  almanac?.tick();
  for (const r of s.requests.splice(0))
    if (r.startsWith('settings:')) void invoke('open_settings', { section: r.slice(9) || null });
    else if (r.startsWith('vercel:')) void invoke('vercel_open', { id: r.slice(7) });
    else if (r.startsWith('vcsite:')) void invoke('vercel_site', { id: r.slice(7) });
    else if (r.startsWith('vcredo:')) vercel?.redeploy(r.slice(7), (id) => invoke('vercel_redeploy', { id }));
    else if (r.startsWith('gh:open:')) void invoke('github_open', { name: r.slice(8) });
    else if (r.startsWith('gh:url:')) void invoke('github_open_url', { url: r.slice(7) });
    else if (r.startsWith('gh:rerun:')) rerunCi(r.slice(9));
    else if (r.startsWith('notion:')) void invoke('notion_open', { id: r.slice(7) });
    else if (r.startsWith('grafana:')) void invoke('grafana_open', { what: r.slice(8) });
    else if (r.startsWith('almanac:')) almanac?.tap(r.slice(8));
    else if (r.startsWith('alweb:')) void invoke('almanac_open', { id: r.slice(6) });
    else if (r.startsWith('caljoin:')) void invoke('calendar_join', { url: r.slice(8) });
    // the settings card
    else if (r === 'host:quit') void invoke('island_action', { id: 'quit' });
    else if (r.startsWith('host:')) {
      saveCard();
      if (r === 'host:vol' || r === 'host:sound') previewSound();
    }
  playSounds();
  if (s.tab === 'settings') cardStatus(now);
  if (inTauri) void syncHotkeys();
  idle = isIdle();
  if (!idle || S.screen !== 'mac') draw();
  // The island moves under a still cursor (opens, closes): re-check the click-through zone.
  updateInteractive();
  if (idle) setTimeout(() => tick(performance.now(), id), IDLE_PERIOD);
  else requestAnimationFrame((t) => tick(t, id));
}

/** The card's connection dots (stage 8g): Claude Code's hooks and every switched-on service. */
let hooksOk: Dot = 'off',
  hooksAsked = -1e9;
function cardStatus(now: number): void {
  if (!s.host) return;
  // the hooks file can change from the settings window or by hand: ask again every 5 s
  if (inTauri && now - hooksAsked > 5000) {
    hooksAsked = now;
    void invoke<{ hooks: boolean }>('island_status').then((st) => (hooksOk = st.hooks ? 'ok' : 'off'));
  }
  const on = (id: ModuleId): boolean => !s.off.includes(id);
  const list: HostPrefs['status'] = [{ name: 'Claude Code', state: hooksOk }];
  const add = (id: ModuleId, name: string, d: { dot(): Dot } | null | undefined): void => {
    if (on(id) && d) list.push({ name, state: d.dot() });
  };
  add('cal', 'Календарь', cal);
  add('github', 'GitHub', github);
  add('vercel', 'Vercel', vercel);
  add('notion', 'Notion', notion);
  add('grafana', 'Grafana', grafana);
  add('almanac', 'Almanac', almanac);
  s.host.status = list;
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
