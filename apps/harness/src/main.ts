// Dev harness: the prototype page around packages/island, plus window.__notch for tools/snapshot.mjs.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/600.css';
import {
  COLORS,
  DEFAULT_THEME,
  EVENT_TYPES,
  SLIDERS,
  createMascot,
  defaultSettings,
  loadSettings,
  saveSettings,
  stageDoubleClick,
  stagePointerDown,
  stagePointerMove,
  stageRelease,
  type Answer,
  type EventType,
  type ModuleId,
  type Settings,
  type Tab,
} from '@almanac-notch/island';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// fonts are fetched lazily; ask for them now so document.fonts.ready waits for them
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

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)').matches;
const S = loadSettings(storage, reducedMQ);
const save = () => saveSettings(storage, S);

const m = createMascot({ settings: S, now: performance.now() });
const s = m.state;

// ---------- canvases (proto: resize) ----------
const stage = $<HTMLCanvasElement>('stage'),
  sc = stage.getContext('2d') as CanvasRenderingContext2D;
const island = $<HTMLCanvasElement>('island');
const loupe = $<HTMLCanvasElement>('loupe');
let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const r = stage.getBoundingClientRect();
  s.W = Math.max(200, r.width);
  s.H = Math.max(200, r.height);
  stage.width = Math.round(s.W * dpr);
  stage.height = Math.round(s.H * dpr);
  const r2 = island.getBoundingClientRect();
  island.width = Math.round(Math.max(240, r2.width) * dpr);
  island.height = Math.round(Math.max(80, r2.height) * dpr);
  const r3 = loupe.getBoundingClientRect();
  loupe.width = Math.round(Math.max(60, r3.width) * dpr);
  loupe.height = Math.round(Math.max(30, r3.height) * dpr);
}
if (window.ResizeObserver) {
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  ro.observe(island);
  ro.observe(loupe);
}
window.addEventListener('resize', resize);
resize();

// proto: readTheme
function readTheme() {
  const cs = getComputedStyle(document.documentElement),
    g = (n: string) => cs.getPropertyValue(n).trim();
  s.theme = {
    top: g('--stage-top') || DEFAULT_THEME.top,
    bot: g('--stage-bot') || DEFAULT_THEME.bot,
    ground: g('--ground') || DEFAULT_THEME.ground,
    muted: g('--muted') || DEFAULT_THEME.muted,
    unlit: g('--unlit') || DEFAULT_THEME.unlit,
    shadowA: parseFloat(g('--shadow-a')) || DEFAULT_THEME.shadowA,
  };
}
readTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
new MutationObserver(readTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

// ---------- stage input ----------
function stagePoint(e: PointerEvent | MouseEvent) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
window.addEventListener('pointermove', (e) => stagePointerMove(s, stagePoint(e), performance.now()), {
  passive: true,
});
stage.addEventListener('pointerdown', (e) => {
  if (!stagePointerDown(s, stagePoint(e), performance.now())) return;
  try {
    stage.setPointerCapture(e.pointerId);
  } catch {
    // capture is a nicety
  }
});
window.addEventListener('pointerup', () => stageRelease(s));
window.addEventListener('pointercancel', () => stageRelease(s));
stage.addEventListener('dblclick', (e) => stageDoubleClick(s, stagePoint(e)));

// ---------- panel ----------
const groups = { eyes: $('g-eyes'), springs: $('g-springs'), behave: $('g-behave') };
const sliderSync: (() => void)[] = [];
for (const sl of SLIDERS) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML =
    '<div class="top"><label for="s-' +
    sl.id +
    '">' +
    sl.label +
    '</label><output id="o-' +
    sl.id +
    '" for="s-' +
    sl.id +
    '"></output></div>' +
    '<input type="range" id="s-' +
    sl.id +
    '" min="' +
    sl.min +
    '" max="' +
    sl.max +
    '" step="' +
    sl.step +
    '">';
  groups[sl.g].appendChild(row);
  const inp = row.querySelector('input') as HTMLInputElement,
    out = row.querySelector('output') as HTMLOutputElement;
  const set = () => {
    out.textContent = sl.f(+inp.value);
  };
  const sync = () => {
    inp.value = String(S[sl.id]);
    set();
  };
  sync();
  sliderSync.push(sync);
  inp.addEventListener('input', () => {
    S[sl.id] = +inp.value;
    set();
    save();
  });
}

const swWrap = $('swatches');
for (const key in COLORS) {
  const col = COLORS[key];
  if (!col) continue;
  const lab = document.createElement('label');
  lab.className = 'sw';
  lab.innerHTML =
    '<input type="radio" name="col" id="c-' +
    key +
    '" value="' +
    key +
    '"><span style="background:' +
    col.body +
    '"></span>' +
    (col.name ?? key);
  const inp = lab.querySelector('input') as HTMLInputElement;
  inp.addEventListener('change', () => {
    if (inp.checked) {
      S.color = key;
      save();
    }
  });
  swWrap.appendChild(lab);
}
type RadioKey = 'screen' | 'workfx' | 'nstate' | 'color';
function bindRadios(name: string, key: RadioKey) {
  document.querySelectorAll<HTMLInputElement>('input[name="' + name + '"]').forEach((i) => {
    i.addEventListener('change', () => {
      if (i.checked) {
        S[key] = i.value;
        save();
      }
    });
  });
}
bindRadios('screen', 'screen');
bindRadios('workfx', 'workfx');
bindRadios('nstate', 'nstate');
function syncRadios() {
  (
    [
      ['screen', 'screen'],
      ['workfx', 'workfx'],
      ['nstate', 'nstate'],
      ['col', 'color'],
    ] as const
  ).forEach(([n, k]) => {
    document.querySelectorAll<HTMLInputElement>('input[name="' + n + '"]').forEach((i) => {
      i.checked = i.value === S[k];
    });
  });
}
const tReduced = $<HTMLInputElement>('t-reduced'),
  tDebug = $<HTMLInputElement>('t-debug');
function syncToggles() {
  tReduced.checked = S.reduced;
  tDebug.checked = S.debug;
}
tReduced.addEventListener('change', () => {
  S.reduced = tReduced.checked;
  save();
});
tDebug.addEventListener('change', () => {
  S.debug = tDebug.checked;
  save();
});
syncRadios();
syncToggles();

// ---------- events and keys ----------
const evButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.ev'));
const isEvent = (v: string | undefined): v is EventType | 'sleep' =>
  v === 'sleep' || EVENT_TYPES.includes(v as EventType);
document.addEventListener('keydown', (e) => {
  const tg = e.target as HTMLElement | null;
  if (
    (tg &&
      (/TEXTAREA|SELECT/.test(tg.tagName) ||
        (tg.tagName === 'INPUT' && !/radio|checkbox|range/.test((tg as HTMLInputElement).type)))) ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey
  )
    return;
  const ev = s.event;
  if (ev && (ev.type === 'attention' || ev.type === 'question') && !ev.answer) {
    const key = e.key.toLowerCase();
    if (ev.type === 'attention' && (key === 'y' || key === 'n')) {
      e.preventDefault();
      m.answer(key === 'y' ? 'approve' : 'deny');
      return;
    }
    if (ev.type === 'question' && ['1', '2', '3'].includes(key)) {
      e.preventDefault();
      m.answer(`opt:${+key - 1}`);
      return;
    }
  }
  const btn = evButtons.find((b) => {
    const k = b.querySelector('kbd');
    return k && (k.textContent ?? '').toLowerCase() === e.key.toLowerCase();
  });
  if (btn && isEvent(btn.dataset['ev'])) {
    e.preventDefault();
    m.trigger(btn.dataset['ev']);
  }
});
evButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    if (isEvent(btn.dataset['ev'])) m.trigger(btn.dataset['ev']);
  }),
);
// proto: updateButtons
s.notify = () => {
  for (const btn of evButtons) {
    const ev = btn.dataset['ev'],
      on = ev === 'sleep' ? s.sleeping : !!(s.event && s.event.type === ev);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
};

const note = $('note'),
  fallback = $<HTMLTextAreaElement>('copyFallback');
$('copyBtn').addEventListener('click', () => {
  const def = defaultSettings(),
    out: Partial<Settings> = {};
  for (const k in def) (out as Record<string, unknown>)[k] = S[k as keyof Settings];
  const txt = JSON.stringify(out, null, 2);
  const done = () => {
    note.textContent = 'Скопировано. Пришли мне в чат, и я зафиксирую эти значения.';
    fallback.hidden = true;
  };
  const fail = () => {
    fallback.hidden = false;
    fallback.value = txt;
    fallback.focus();
    fallback.select();
    note.textContent = 'Буфер обмена недоступен - скопируй текст ниже вручную.';
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fail);
    else fail();
  } catch {
    fail();
  }
});
$('resetBtn').addEventListener('click', () => {
  Object.assign(S, defaultSettings(reducedMQ));
  sliderSync.forEach((f) => f());
  syncRadios();
  syncToggles();
  save();
  note.textContent = 'Настройки сброшены.';
  fallback.hidden = true;
});

// proto: updateLayersUI
const Lr = { ev: $('L-ev'), ia: $('L-ia'), bg: $('L-bg') };
const Vr = { ev: $('V-ev'), ia: $('V-ia'), bg: $('V-bg') };
function updateLayersUI() {
  const lt = s.layerText;
  const top = lt.ev ? 'ev' : lt.ia ? 'ia' : 'bg';
  for (const k of ['ev', 'ia', 'bg'] as const) {
    Vr[k].textContent = lt[k] || '-';
    Lr[k].classList.toggle('on', k === top);
  }
}

// ---------- debug API for tools/snapshot.mjs ----------
declare global {
  interface Window {
    __notch: {
      setScreen(v: 'mac' | 'win'): void;
      setNotchState(v: 'auto' | 'closed' | 'half' | 'open'): void;
      trigger(type: EventType | 'sleep'): void;
      setFocus(id: ModuleId | null): void;
      setTab(tab: Tab): void;
      poke(n: number): void;
      answer(a: Answer): void;
    };
  }
}
window.__notch = {
  setScreen: (v) => {
    S.screen = v;
  },
  setNotchState: (v) => {
    S.nstate = v;
  },
  trigger: (type) => m.trigger(type),
  setFocus: (id) => m.setFocus(id),
  setTab: (tab) => m.setTab(tab),
  poke: (n) => m.poke(n),
  answer: (a) => m.answer(a),
};

// ---------- frame loop (proto: frame) ----------
let last = performance.now(),
  lastUI = 0;
function frame(now: number) {
  const realDt = Math.min((now - last) / 1000, 0.05);
  last = now;
  m.update(realDt * S.timeScale, now);
  m.renderStage(sc, dpr);
  stage.style.cursor = m.stageCursor();
  if (now - lastUI > 100) {
    updateLayersUI();
    lastUI = now;
  }
  requestAnimationFrame(frame);
}
s.notify();
requestAnimationFrame(frame);
