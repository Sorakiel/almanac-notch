// Open state: top bar with tabs and settings, then the active tab (docs/SPEC.md 2.4-2.9).
import { clamp, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState, ModuleId, Tab } from '../sim/state';
import type { Status } from '../sim/events';
import type { WorkFx } from './fx';
import { effectiveFocus } from './focus';
import { addHit, hovering, withScale } from './hits';
import { card, cardTint } from './card';
import { drawAlert, drawAsk, drawFocusCard, drawLaunch } from './cards';
import { drawMusicWide, drawRail } from './music';
import { drawAdd, drawChat, drawSettings } from './tabs';
import { drawLeaving, layer, shared, springK, tabOutA } from './reveal';
import { focusTint, isHot, miniFor, modules, type ModuleItem } from './modules';
import { MODULE_COL } from './focus';
import { drawMini } from './crew';
import { hexA } from '../util/math';

type IconKind = 'home' | 'chat' | 'add' | 'gear' | 'sound';

/** proto: icon */
export function icon(s: IslandState, c: Ctx, kind: IconKind, x: number, y: number, active: boolean): void {
  if (s.iconSet === 'solid') return solidIcon(s, c, kind, x, y, active);
  c.save();
  c.strokeStyle = c.fillStyle = active ? '#FFFFFF' : 'rgba(255,255,255,0.6)';
  c.lineWidth = 1.5;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (kind === 'home') {
    c.beginPath();
    c.moveTo(x - 6, y - 0.5);
    c.lineTo(x, y - 6);
    c.lineTo(x + 6, y - 0.5);
    c.moveTo(x - 4.5, y - 2);
    c.lineTo(x - 4.5, y + 5);
    c.lineTo(x + 4.5, y + 5);
    c.lineTo(x + 4.5, y - 2);
    c.stroke();
  } else if (kind === 'chat') {
    rrect(c, x - 6.5, y - 5.5, 13, 9.5, 3);
    c.stroke();
    c.beginPath();
    c.moveTo(x - 3, y + 4);
    c.lineTo(x - 4.5, y + 6.5);
    c.lineTo(x, y + 4);
    c.stroke();
  } else if (kind === 'add') {
    c.beginPath();
    c.moveTo(x - 5.5, y);
    c.lineTo(x + 5.5, y);
    c.moveTo(x, y - 5.5);
    c.lineTo(x, y + 5.5);
    c.stroke();
  } else if (kind === 'gear') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * 4.6, y + Math.sin(a) * 4.6);
      c.lineTo(x + Math.cos(a) * 6.6, y + Math.sin(a) * 6.6);
      c.stroke();
    }
    c.beginPath();
    c.arc(x, y, 4.4, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(x, y, 1.6, 0, Math.PI * 2);
    c.stroke();
  } else {
    c.beginPath();
    c.moveTo(x - 6, y - 2.2);
    c.lineTo(x - 3.5, y - 2.2);
    c.lineTo(x, y - 5.2);
    c.lineTo(x, y + 5.2);
    c.lineTo(x - 3.5, y + 2.2);
    c.lineTo(x - 6, y + 2.2);
    c.closePath();
    c.stroke();
    if (s.muted) {
      c.beginPath();
      c.moveTo(x + 2.5, y - 3);
      c.lineTo(x + 7, y + 3);
      c.moveTo(x + 7, y - 3);
      c.lineTo(x + 2.5, y + 3);
      c.stroke();
    } else {
      c.beginPath();
      c.arc(x + 1, y, 3.4, -0.9, 0.9);
      c.stroke();
      c.beginPath();
      c.arc(x + 1, y, 6.2, -0.9, 0.9);
      c.stroke();
    }
  }
  c.restore();
}

// Filled top-bar icons for the app (docs/CHANGES.md 2026-10-17): drawn on a 24-unit grid,
// scaled to the prototype's ~13 px glyph box. Paths are our own, not a system symbol set.
// 2026-10-19: a size smaller and softer, as Grok Bot's bar: the icons are the frame, not the content
const SOLID_SCALE = 0.56;
const P_HOME =
  'M12 3.3c.4 0 .8.1 1.1.4l8.2 7.1c.7.6.3 1.7-.6 1.7H19.5v7.4c0 .9-.7 1.6-1.6 1.6h-3.4v-5.2c0-.6-.4-1-1-1h-3c-.6 0-1 .4-1 1v5.2H6.1c-.9 0-1.6-.7-1.6-1.6v-7.4H3.3c-.9 0-1.3-1.1-.6-1.7l8.2-7.1c.3-.3.7-.4 1.1-.4Z';
const P_CHAT =
  'M6.2 4h11.6c2 0 3.7 1.7 3.7 3.7v6.1c0 2-1.7 3.7-3.7 3.7h-6.9l-4.6 3.3c-.6.4-1.4-.1-1.2-.8l.6-2.6c-1.7-.4-3.2-1.9-3.2-3.6V7.7C2.5 5.7 4.2 4 6.2 4Z';
const P_SPEAKER =
  'M4 8.6h2.9l4.5-3.8c.7-.6 1.7-.1 1.7.8v12.8c0 .9-1 1.4-1.7.8l-4.5-3.8H4c-.8 0-1.5-.7-1.5-1.5V10.1c0-.8.7-1.5 1.5-1.5Z';
const pathCache = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) pathCache.set(d, (p = new Path2D(d)));
  return p;
}
/** a cog: 8 rounded teeth around a ring, the hole cut out (even-odd) */
function gearPath(): Path2D {
  let p = pathCache.get('gear');
  if (p) return p;
  p = new Path2D();
  const teeth = 7,
    rIn = 8,
    rOut = 10,
    half = (Math.PI / teeth) * 0.5;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2,
      r = i % 2 === 0 ? rOut : rIn,
      w = i % 2 === 0 ? half : half * 1.25;
    const x0 = 12 + Math.cos(a - w) * r,
      y0 = 12 + Math.sin(a - w) * r;
    if (i === 0) p.moveTo(x0, y0);
    else p.lineTo(x0, y0);
    p.lineTo(12 + Math.cos(a + w) * r, 12 + Math.sin(a + w) * r);
  }
  p.closePath();
  p.moveTo(12 + 3.4, 12);
  p.arc(12, 12, 3.4, 0, Math.PI * 2);
  pathCache.set('gear', p);
  return p;
}

function solidIcon(s: IslandState, c: Ctx, kind: IconKind, x: number, y: number, active: boolean): void {
  c.save();
  const col = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.42)';
  c.fillStyle = c.strokeStyle = col;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.translate(x - 12 * SOLID_SCALE, y - 12 * SOLID_SCALE);
  c.scale(SOLID_SCALE, SOLID_SCALE);
  if (kind === 'home') c.fill(path(P_HOME));
  else if (kind === 'chat') c.fill(path(P_CHAT));
  else if (kind === 'add') {
    // a plus cut out of a filled circle, like the other filled glyphs (a bare thick cross read heavy)
    c.beginPath();
    c.arc(12, 12, 9.5, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#0B0B0D';
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(12, 7.6);
    c.lineTo(12, 16.4);
    c.moveTo(7.6, 12);
    c.lineTo(16.4, 12);
    c.stroke();
  } else if (kind === 'gear') {
    // a wide round stroke rounds the teeth: square teeth read hard
    c.lineWidth = 2.4;
    c.fill(gearPath(), 'evenodd');
    c.stroke(gearPath());
  } else {
    c.fill(path(P_SPEAKER));
    c.lineWidth = 1.8;
    c.beginPath();
    if (s.muted) {
      c.moveTo(16, 9.5);
      c.lineTo(21, 14.5);
      c.moveTo(21, 9.5);
      c.lineTo(16, 14.5);
    } else {
      c.arc(13.5, 12, 3.6, -0.85, 0.85);
      c.moveTo(13.5 + Math.cos(-0.85) * 7, 12 + Math.sin(-0.85) * 7);
      c.arc(13.5, 12, 7, -0.85, 0.85);
    }
    c.stroke();
  }
  c.restore();
}

/** proto: topBar */
export function topBar(s: IslandState, c: Ctx, x0: number, x1: number, y: number): void {
  const tabs: [Tab & IconKind, string][] = [
    ['home', 'tab:home'],
    ['chat', 'tab:chat'],
    ['add', 'tab:add'],
  ].filter(([k]) => !(s.chatOff && k === 'chat')) as [Tab & IconKind, string][];
  const right: [IconKind, string, number][] = [
    ['gear', 'tab:settings', x1 - 50],
    ['sound', 'mute', x1 - 22],
  ];
  // the active capsule travels from the tab we left to the new one (docs/CHANGES.md 2026-10-19):
  // the eye follows one object instead of two capsules blinking; across the notch to the gear it
  // cross-fades, a slide that long under the camera would read as lag
  const tabX = (t: Tab): number | null => {
    if (t === 'settings') return x1 - 50;
    const i = tabs.findIndex(([k]) => k === t);
    return i < 0 ? null : x0 + 22 + i * 30;
  };
  const dt = s.t - s.tabStart,
    xNew = tabX(s.tab),
    xOld = s.prevTab !== s.tab ? tabX(s.prevTab) : null;
  const pill = (x: number, a: number) => {
    c.save();
    c.globalAlpha *= a;
    c.fillStyle = 'rgba(255,255,255,0.16)';
    rrect(c, x - 13, y - 11, 26, 22, 11);
    c.fill();
    c.restore();
  };
  if (xNew !== null) {
    if (xOld === null || dt >= 0.9) pill(xNew, 1);
    else if (s.tab !== 'settings' && s.prevTab !== 'settings') pill(xOld + (xNew - xOld) * springK(dt, 0.3, 0.78), 1);
    else {
      const k = clamp(dt / 0.16, 0, 1);
      pill(xOld, 1 - k);
      pill(xNew, k);
    }
  }
  tabs.forEach(([k, act], i) => {
    const x = x0 + 22 + i * 30,
      on = s.tab === k,
      hov = hovering(s, x - 13, y - 11, 26, 22);
    if (!on && hov) {
      c.fillStyle = 'rgba(255,255,255,0.08)';
      rrect(c, x - 13, y - 11, 26, 22, 11);
      c.fill();
    }
    icon(s, c, k, x, y, on);
    addHit(s, c, { x: x - 13, y: y - 11, w: 26, h: 22, act });
  });
  right.forEach(([k, act, x]) => {
    const on = k === 'gear' && s.tab === 'settings',
      hov = hovering(s, x - 13, y - 11, 26, 22);
    if (!on && hov) {
      c.fillStyle = 'rgba(255,255,255,0.08)';
      rrect(c, x - 13, y - 11, 26, 22, 11);
      c.fill();
    }
    icon(s, c, k, x, y, on);
    addHit(s, c, { x: x - 13, y: y - 11, w: 26, h: 22, act });
  });
}

/** proto: drawOpen */
export function drawOpen(
  s: IslandState,
  c: Ctx,
  x0: number,
  x1: number,
  top: number,
  bottom: number,
  _st: Status | null,
  fx: WorkFx | null,
  barY: number,
): void {
  topBar(s, c, x0, x1, barY);
  const pad = 10,
    cy0 = top + 2,
    cy1 = bottom - pad,
    X0 = x0 + pad,
    X1 = x1 - pad;
  if (cy1 - cy0 < 40) return;
  if (s.event && s.event.type === 'greeting') {
    drawLaunch(s, c, X0, X1, cy0, cy1);
    return;
  }
  const aA = clamp(s.sp.alertA.x, 0, 1);
  if (aA > 0.01) {
    c.save();
    c.globalAlpha *= aA;
    drawAlert(s, c, X0, X1, cy0, cy1);
    c.restore();
  }
  if (aA < 0.99) {
    c.save();
    c.globalAlpha *= 1 - aA;
    c.translate(0, aA * 6);
    // a left card both tabs have (home's focus card, chat, the app's settings) stays and changes
    // width with a spring instead of blinking out and in, as Grok Bot and coucou keep their card
    const dt = s.t - s.tabStart,
      wOld = leftCardW(s, s.prevTab, X0, X1),
      wNew = leftCardW(s, s.tab, X0, X1);
    shared.card = s.prevTab !== s.tab && dt < 0.6 && wOld !== null && wNew !== null;
    if (shared.card && wOld !== null && wNew !== null)
      card(c, X0, cy0, wOld + (wNew - wOld) * springK(dt, 0.35, 0.86), cy1 - cy0, false);
    const outA = tabOutA(s);
    if (outA > 0) {
      // the tab we leave: fades and sinks a little, takes no clicks
      const tab = s.tab,
        n = s.hits.length;
      s.tab = s.prevTab;
      c.save();
      c.globalAlpha *= outA;
      if (!shared.card) {
        const mx = (X0 + X1) / 2,
          my = (cy0 + cy1) / 2,
          sc = 0.985 + 0.015 * outA;
        c.translate(mx, my);
        c.scale(sc, sc);
        c.translate(-mx, -my);
      }
      drawLeaving(() => drawOpenBody(s, c, X0, X1, cy0, cy1, fx));
      c.restore();
      s.tab = tab;
      s.hits.length = n;
    }
    drawOpenBody(s, c, X0, X1, cy0, cy1, fx);
    shared.card = false;
    c.restore();
  }
}

/** the focus card takes this share of home: the active module says more than the others together */
const SPLIT = 0.58;
/** the module rail beside a big event card, as Grok Bot's */
const RAIL_W = 52;
/** the card's content (mascot, text, buttons) is drawn this much bigger than the prototype's,
 * as Grok Bot's - the island grew, its content grows with it instead of floating in space */
const CARD_K = 1.18;
/** the prototype's content block height; it sits in the middle of the card */
const BLOCK_H = 104;

/** draw a card's content scaled by CARD_K, centred in the card's height */
function bigFocus(
  s: IslandState,
  c: Ctx,
  f: ModuleId,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fx: WorkFx | null,
): void {
  const k = CARD_K,
    h = (y1 - y0) / k,
    ins = Math.max(0, (h - BLOCK_H) / 2);
  withScale(s, c, x0, y0, k, () => drawFocusCard(s, c, f, x0, y0 + ins, x0 + (x1 - x0) / k, y0 + h - ins, fx));
}

/** an event that takes the big card, the other modules wait in the rail */
function railEvent(s: IslandState): boolean {
  const ev = s.event && s.event.type;
  return ev === 'attention' || ev === 'question' || ev === 'success' || ev === 'error';
}

/** width of the tab's left card when it has one (the card the tabs share in a switch) */
function leftCardW(s: IslandState, tab: Tab, X0: number, X1: number): number | null {
  if (tab === 'chat' && !s.chatOff) return 112;
  if (tab === 'settings') return s.host ? X1 - X0 : null;
  if (tab !== 'home') return null;
  if (railEvent(s)) return X1 - X0 - RAIL_W - 8;
  if (effectiveFocus(s) === 'music') return null;
  return (X1 - X0) * SPLIT - 4;
}

/** proto: drawOpenBody - the active tab; on home the focus card plus the other modules */
export function drawOpenBody(
  s: IslandState,
  c: Ctx,
  X0: number,
  X1: number,
  cy0: number,
  cy1: number,
  fx: WorkFx | null,
): void {
  if (s.tab !== 'home') {
    c.save();
    // chat and settings layer their own rows; the add tab is one layer until the shelf replaces it
    if (s.tab === 'add') layer(s, c, 0);
    if (s.tab === 'chat' && !s.chatOff) drawChat(s, c, X0, X1, cy0, cy1);
    else if (s.tab === 'add') drawAdd(s, c, X0, X1, cy0, cy1);
    else if (s.tab === 'settings') drawSettings(s, c, X0, X1, cy0, cy1);
    c.restore();
    if (s.tab !== 'chat' || !s.chatOff) return;
  }
  const gap = 8;
  const f = effectiveFocus(s);
  const k = ss(0, 1, (s.t - s.focusStart) / 0.28);
  // permission, question, done, error: one big card, the other modules as a rail of mascots
  if (railEvent(s)) {
    const bx1 = X1 - RAIL_W - gap;
    c.save();
    layer(s, c, 0);
    if (s.event && (s.event.type === 'attention' || s.event.type === 'question'))
      withScale(s, c, X0, cy0, CARD_K, () =>
        drawAsk(s, c, X0, X0 + (bx1 - X0) / CARD_K, cy0, cy0 + (cy1 - cy0) / CARD_K, fx),
      );
    else {
      if (!shared.card) card(c, X0, cy0, bx1 - X0, cy1 - cy0, false);
      const tintC = focusTint(s, f);
      if (tintC) cardTint(c, X0, cy0, bx1 - X0, cy1 - cy0, tintC.c, tintC.a);
      bigFocus(s, c, f, X0, cy0, bx1, cy1, fx);
    }
    c.restore();
    c.save();
    layer(s, c, 1);
    drawRail(
      s,
      c,
      X1 - RAIL_W,
      X1,
      cy0,
      cy1,
      modules(s).filter((m) => m.id !== f),
    );
    c.restore();
    return;
  }
  if (f === 'music') {
    c.save();
    layer(s, c, 0);
    c.globalAlpha *= k;
    c.translate((1 - k) * 8, 0);
    drawMusicWide(s, c, X0, X1 - RAIL_W - gap, cy0, cy1);
    c.restore();
    c.save();
    layer(s, c, 1);
    drawRail(
      s,
      c,
      X1 - RAIL_W,
      X1,
      cy0,
      cy1,
      modules(s).filter((m) => m.id !== 'music'),
    );
    c.restore();
    return;
  }
  const split = X0 + (X1 - X0) * SPLIT;
  c.save();
  layer(s, c, 0);
  if (!shared.card) card(c, X0, cy0, split - X0 - gap / 2, cy1 - cy0, false);
  const tintC = focusTint(s, f);
  if (tintC) cardTint(c, X0, cy0, split - X0 - gap / 2, cy1 - cy0, tintC.c, tintC.a);
  c.save();
  c.globalAlpha *= k;
  c.translate((1 - k) * 8, 0);
  bigFocus(s, c, f, X0, cy0, split - gap / 2, cy1, fx);
  c.restore();
  c.restore();
  // the other modules: Grok Bot's grid - one card, a 2 × 2 of pills, each a small mascot in its
  // colour and the name. The state is the mascot's mood and the pill's rim, not words: the focus
  // card on the left is where the reading happens
  const items = modules(s)
    .filter((m) => m.id !== f)
    .slice(0, 4);
  const gx0 = split + gap / 2,
    gw = X1 - gx0,
    pad = 10,
    pg = 8,
    pw = (gw - pad * 2 - pg) / 2,
    ph = 34,
    rows = Math.ceil(items.length / 2),
    py0 = cy0 + (cy1 - cy0 - (rows * ph + (rows - 1) * pg)) / 2;
  c.save();
  layer(s, c, 1);
  card(c, gx0, cy0, gw, cy1 - cy0, false);
  c.restore();
  items.forEach((it, i) => {
    c.save();
    layer(s, c, 1 + i);
    modulePill(s, c, it, gx0 + pad + (i % 2) * (pw + pg), py0 + Math.floor(i / 2) * (ph + pg), pw, ph);
    c.restore();
  });
}

/** a module as a pill: a dark fill tinted with its colour, a rim of it, its mascot and the name */
function modulePill(s: IslandState, c: Ctx, it: ModuleItem, x: number, y: number, w: number, h: number): void {
  const col = MODULE_COL[it.id].body,
    hov = hovering(s, x, y, w, h),
    hot = isHot(it),
    r = h / 2;
  rrect(c, x, y, w, h, r);
  c.fillStyle = hexA(col, hov ? 0.13 : 0.06);
  c.fill();
  c.lineWidth = 1;
  c.strokeStyle = hexA(col, hov ? 0.45 : hot ? 0.34 : 0.16);
  rrect(c, x + 0.5, y + 0.5, w - 1, h - 1, r - 0.5);
  c.stroke();
  drawMini(s, c, x + r, y + h / 2 + 0.5, h * 0.3, miniFor(it));
  const tx = x + h + 1;
  textAt(c, it.name, tx, y + h / 2 + 0.5, { size: 12, color: mixWhite(col, 0.45), max: w - (tx - x) - 10 });
  addHit(s, c, { x, y, w, h, act: 'focus:' + it.id });
}

/** a module colour lifted toward white, for text on its own tint */
function mixWhite(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16),
    m = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}
