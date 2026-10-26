// Examples inside two settings pages (stage 9f), where words alone leave a person guessing:
// the Island page plays the real island (the island package, the prototype's sample day) under
// a moving pointer with the window's own choices; the Keys page shows the island's permission
// card with the keys that answer it now. The header is for character, these are for understanding.
import {
  createMascot,
  defaultSettings,
  islandPointerDown,
  islandPointerLeave,
  islandPointerMove,
} from '@almanac-notch/island';
import { KEY_DEFAULTS, comboLabel, readKeys } from './keys';
import { t } from './settings-i18n';

const isMac = navigator.userAgent.includes('Mac');
/** the island's choices, from the storage the window and the island share */
function card(): { hover: boolean; close: number } {
  try {
    const v = JSON.parse(localStorage.getItem('almanac-notch.card') ?? '{}') as {
      openOnHover?: unknown;
      autoClose?: unknown;
    };
    const c = typeof v.autoClose === 'number' ? v.autoClose : 5;
    return { hover: v.openOnHover !== false, close: c <= 3 ? 3 : c <= 5 ? 5 : 10 };
  } catch {
    return { hover: true, close: 5 };
  }
}

// ---------- the Island page: the island itself ----------
export interface IslandExample {
  /** the page is on screen: play from the start with the current choices */
  play: () => void;
  stop: () => void;
}

export function islandExample(host: HTMLElement): IslandExample {
  host.className = 'example';
  host.innerHTML =
    '<div class="screen"><canvas class="live"></canvas><svg class="cursor" viewBox="0 0 16 16"><path d="M2 1l11 8-5 1 3 5-2 1-3-5-4 3z"/></svg></div><p class="cap"></p>';
  const live = host.querySelector('canvas') as HTMLCanvasElement,
    cursor = host.querySelector('.cursor') as SVGElement,
    cap = host.querySelector('.cap') as HTMLElement;
  const m = createMascot({ settings: defaultSettings(false), now: performance.now(), greetAfter: null });
  const s = m.state;
  // the prototype's sample day and its desk: a lived-in island at the top of a small screen (the desk itself is the card)
  // no painted desk: the card is the screen, so nothing grey is left below the island
  s.bare = true;
  const prefs = { openOnHover: true, autoClose: 5, status: [], version: '', volume: 0.6 };
  s.host = prefs;
  s.notchW = 185;
  s.mb = 33.5;
  s.IW = 680;
  s.IH = 230;
  s.event = null;
  s.postLaunchUntil = 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  live.width = s.IW * dpr;
  live.height = s.IH * dpr;
  const off = document.createElement('canvas');
  off.width = live.width;
  off.height = live.height;
  const ic = live.getContext('2d') as CanvasRenderingContext2D,
    oc = off.getContext('2d') as CanvasRenderingContext2D;

  /** a hand moving: the island gets every step, as from a real mouse */
  let path: { x: number; y: number; t: number }[] = [];
  const glide = (x0: number, y0: number, x1: number, y1: number, ms: number, at: number): void => {
    for (let i = 0; i <= 20; i++) {
      const k = i / 20,
        e = 1 - (1 - k) ** 3;
      path.push({ x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e, t: at + ms * k });
    }
  };
  let t0 = 0,
    clickAt = -1,
    loopMs = 0,
    clicked = false,
    inside = false,
    lastT = performance.now(),
    raf = 0,
    choice = card();
  const notes: [number, string][] = [];
  function plan(): void {
    choice = card();
    path = [];
    notes.length = 0;
    prefs.openOnHover = choice.hover;
    prefs.autoClose = choice.close;
    s.clickOpen = false;
    clicked = false;
    t0 = performance.now();
    glide(560, 178, 340, 14, 900, 300);
    glide(340, 14, 380, 60, 400, 1300);
    if (choice.hover) {
      notes.push(
        [0, t('Курсор у выреза - остров открывается')],
        [3000, t('Курсор ушёл - остров закрывается почти сразу')],
      );
      glide(380, 60, 120, 178, 700, 3000);
      clickAt = -1;
      loopMs = 5200;
    } else {
      notes.push(
        [0, t('Курсор у выреза - остров только выглядывает')],
        [2300, t('Клик - остров открыт и ждёт {0} с после ухода курсора', choice.close)],
      );
      clickAt = 2300;
      glide(380, 60, 120, 178, 700, 3200);
      loopMs = 4200 + choice.close * 1000 + 800;
    }
  }
  function frame(now: number): void {
    const tt = now - t0;
    if (tt > loopMs) plan();
    let p = path[0];
    for (const q of path) if (q.t <= tt) p = q;
    if (p) {
      // the example is the island's window scaled to the box: the cursor in island points
      const k = live.clientWidth / s.IW;
      cursor.style.transform = `translate(${live.offsetLeft + p.x * k}px, ${live.offsetTop + p.y * k}px)`;
      const isIn = p.x >= 0 && p.y >= 0 && p.x < s.IW && p.y < 200;
      if (isIn) islandPointerMove(s, p, now);
      else if (inside) islandPointerLeave(s);
      inside = isIn;
    }
    if (clickAt >= 0 && !clicked && tt >= clickAt && p) {
      clicked = true;
      islandPointerDown(s, p);
    }
    let note = '';
    for (const [at, text] of notes) if (tt >= at) note = text;
    if (cap.textContent !== note) cap.textContent = note;
    m.update(Math.min(0.05, (now - lastT) / 1000), now);
    lastT = now;
    m.renderIsland(ic, oc);
    raf = requestAnimationFrame(frame);
  }
  // the window changed a choice: the example plays it at once
  window.addEventListener('storage', (e) => {
    if (e.key === 'almanac-notch.card' && raf) plan();
  });
  document.addEventListener('settings:card', () => raf && plan());
  return {
    play: () => {
      plan();
      lastT = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    stop: () => {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

// ---------- the Keys page: the island's permission card ----------
export function keysExample(host: HTMLElement): () => void {
  host.className = 'example';
  host.innerHTML =
    '<div class="perm"><div class="perm-top"><i></i>Claude Code <span></span></div><code>git push origin main</code><div class="perm-btns"><span class="pb"><b></b><kbd></kbd></span><span class="pb pri"><b></b><kbd></kbd></span></div></div><p class="cap"></p>';
  const kbds = host.querySelectorAll('kbd'),
    names = host.querySelectorAll('.pb b');
  let last = ['', ''];
  return () => {
    const say = (el: Element | null | undefined, text: string): void => {
      if (el) el.textContent = text;
    };
    say(host.querySelector('.perm-top span'), t('нужно разрешение'));
    say(names[0], t('Отклонить'));
    say(names[1], t('Разрешить'));
    say(host.querySelector('.cap'), t('Так кнопки выглядят в острове - с вашими клавишами'));
    const k = readKeys();
    // as the island draws them (main.ts showKeyHints): the letter while it is the shipped key
    const hint = (a: 'approve' | 'deny'): string =>
      !k[a].on ? '' : k[a].combo === KEY_DEFAULTS[a] ? KEY_DEFAULTS[a].slice(-1) : comboLabel(k[a].combo, isMac);
    const next = [hint('deny'), hint('approve')];
    next.forEach((v, i) => {
      const el = kbds[i] as HTMLElement;
      el.textContent = v;
      el.hidden = !v;
      // the changed one gives a small nod: this is what you just set
      if (last[i] && v !== last[i]) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
    });
    last = next;
  };
}
