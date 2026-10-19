// Open state: top bar with tabs and settings, then the active tab (docs/SPEC.md 2.4-2.9).
import { hoverK, pressScale } from './hover';
import { clamp, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState, ModuleId, Tab } from '../sim/state';
import type { Status } from '../sim/events';
import type { WorkFx } from './fx';
import { effectiveFocus } from './focus';
import { addHit, hovering, withScale } from './hits';
import { card, cardTint, haloTint } from './card';
import { ciAlert } from './ci';
import { drawAlert, drawAsk, drawFocusCard, drawLaunch } from './cards';
import { drawMusicWide, drawRail } from './music';
import { drawAdd, drawChat, drawSettings } from './tabs';
import { drawLeaving, layer, shared, springK, tabOutA } from './reveal';
import { deepCol, focusTint, isHot, miniFor, modules, type ModuleItem } from './modules';
import { MODULE_COL } from './focus';
import { drawMini } from './crew';
import { hexA } from '../util/math';
import { EV_OUT, eventInDt, evTextA, evTintA, evWidthK, seq } from './eventIn';
import {
  cardFade,
  drawLate,
  flushLate,
  flyBox,
  flyDt,
  flyMascot,
  markBox,
  markSpot,
  newPillA,
  startFlight,
  toLocal,
} from './flight';

type IconKind = 'home' | 'chat' | 'add' | 'gear' | 'sound';

/** proto: icon */
export function icon(s: IslandState, c: Ctx, kind: IconKind, x: number, y: number, active: boolean, hk = 0): void {
  if (s.iconSet === 'solid') return solidIcon(s, c, kind, x, y, active, hk);
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

// Top-bar icons of the app (docs/CHANGES.md 2026-10-19): one family on a 24-unit grid, drawn at
// 18 px - the way tab bars do it: an outline when idle (1.4 px, round caps and joins), the same
// shape filled when active. The earlier set mixed filled blobs with a thick toothed gear and read
// harsh. Paths are our own.
const ICON_Z = 0.75;
const ICON_LW = 1.9;
const P_HOME =
  'M3.8 10.2 11 4.3a1.6 1.6 0 0 1 2 0l7.2 5.9c.5.4.8 1 .8 1.6V19a2 2 0 0 1-2 2h-3.4a.6.6 0 0 1-.6-.6v-4.2a1.6 1.6 0 0 0-1.6-1.6h-2.8a1.6 1.6 0 0 0-1.6 1.6v4.2a.6.6 0 0 1-.6.6H5a2 2 0 0 1-2-2v-7.2c0-.6.3-1.2.8-1.6Z';
const P_CHAT =
  'M7 4.5h10a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-4.6l-4.1 3.1c-.5.4-1.3 0-1.3-.6v-2.6A4 4 0 0 1 3 13.5v-5a4 4 0 0 1 4-4Z';
const P_SPEAKER =
  'M4.5 9h2.8l4.4-3.7c.6-.5 1.5-.1 1.5.7v12c0 .8-.9 1.2-1.5.7L7.3 15H4.5A1.5 1.5 0 0 1 3 13.5v-3A1.5 1.5 0 0 1 4.5 9Z';
const pathCache = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) pathCache.set(d, (p = new Path2D(d)));
  return p;
}
/** a cog with 8 short rounded teeth (round joins do the rounding) */
function gearPath(): Path2D {
  let p = pathCache.get('gear');
  if (p) return p;
  p = new Path2D();
  const teeth = 8,
    rIn = 7.6,
    rOut = 9.7;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2 - Math.PI / 2,
      half = Math.PI / teeth;
    const pt = (ang: number, r: number) => [12 + Math.cos(ang) * r, 12 + Math.sin(ang) * r] as const;
    const [x0, y0] = pt(a - half * 0.55, rOut),
      [x1, y1] = pt(a + half * 0.55, rOut),
      [x2, y2] = pt(a + half * 0.75, rIn),
      [x3, y3] = pt(a + half * 1.25, rIn);
    if (i === 0) p.moveTo(x0, y0);
    else p.lineTo(x0, y0);
    p.lineTo(x1, y1);
    p.lineTo(x2, y2);
    p.lineTo(x3, y3);
  }
  p.closePath();
  pathCache.set('gear', p);
  return p;
}

function solidIcon(s: IslandState, c: Ctx, kind: IconKind, x: number, y: number, active: boolean, hk = 0): void {
  c.save();
  const col = active ? 'rgba(255,255,255,0.95)' : `rgba(255,255,255,${(0.5 + 0.3 * hk).toFixed(3)})`;
  c.fillStyle = c.strokeStyle = col;
  c.lineWidth = ICON_LW;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.translate(x - 12 * ICON_Z, y - 12 * ICON_Z);
  c.scale(ICON_Z, ICON_Z);
  const shape = (p: Path2D) => (active ? c.fill(p) : c.stroke(p));
  if (kind === 'home') shape(path(P_HOME));
  else if (kind === 'chat') shape(path(P_CHAT));
  else if (kind === 'add') {
    c.beginPath();
    c.arc(12, 12, 8.6, 0, Math.PI * 2);
    if (active) c.fill();
    else c.stroke();
    c.strokeStyle = active ? '#0B0B0D' : col;
    c.beginPath();
    c.moveTo(12, 8.2);
    c.lineTo(12, 15.8);
    c.moveTo(8.2, 12);
    c.lineTo(15.8, 12);
    c.stroke();
  } else if (kind === 'gear') {
    if (active) {
      const p = new Path2D();
      p.addPath(gearPath());
      p.moveTo(15, 12);
      p.arc(12, 12, 3, 0, Math.PI * 2);
      c.stroke(gearPath());
      c.fill(p, 'evenodd');
    } else {
      c.stroke(gearPath());
      c.beginPath();
      c.arc(12, 12, 3, 0, Math.PI * 2);
      c.stroke();
    }
  } else {
    shape(path(P_SPEAKER));
    c.beginPath();
    if (s.muted) {
      c.moveTo(16.4, 9.6);
      c.lineTo(21, 14.4);
      c.moveTo(21, 9.6);
      c.lineTo(16.4, 14.4);
    } else {
      c.arc(14.2, 12, 3.4, -0.8, 0.8);
      c.moveTo(14.2 + Math.cos(-0.8) * 6.6, 12 + Math.sin(-0.8) * 6.6);
      c.arc(14.2, 12, 6.6, -0.8, 0.8);
    }
    c.stroke();
  }
  c.restore();
}

/** top bar layout (2026-10-19, after Grok Bot): 40 apart, a 36 x 26 capsule with a hairline rim */
const BAR_L = 26,
  BAR_STEP = 40,
  CAP_W = 36,
  CAP_H = 26;

/** proto: topBar */
export function topBar(s: IslandState, c: Ctx, x0: number, x1: number, y: number): void {
  const tabs: [Tab & IconKind, string][] = [
    ['home', 'tab:home'],
    ['chat', 'tab:chat'],
    ['add', 'tab:add'],
  ].filter(([k]) => !(s.chatOff && k === 'chat')) as [Tab & IconKind, string][];
  const gearX = x1 - BAR_L - BAR_STEP + 4,
    right: [IconKind, string, number][] = [
      ['gear', 'tab:settings', gearX],
      ['sound', 'mute', x1 - BAR_L + 2],
    ];
  // the active capsule travels from the tab we left to the new one (docs/CHANGES.md 2026-10-19):
  // the eye follows one object instead of two capsules blinking; across the notch to the gear it
  // cross-fades, a slide that long under the camera would read as lag
  const tabX = (t: Tab): number | null => {
    if (t === 'settings') return gearX;
    const i = tabs.findIndex(([k]) => k === t);
    return i < 0 ? null : x0 + BAR_L + i * BAR_STEP;
  };
  const dt = s.t - s.tabStart,
    xNew = tabX(s.tab),
    xOld = s.prevTab !== s.tab ? tabX(s.prevTab) : null;
  const pill = (x: number, a: number, hover = false) => {
    c.save();
    c.globalAlpha *= a;
    rrect(c, x - CAP_W / 2, y - CAP_H / 2, CAP_W, CAP_H, CAP_H / 2);
    c.fillStyle = hover ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.13)';
    c.fill();
    if (!hover) {
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(255,255,255,0.07)';
      rrect(c, x - CAP_W / 2 + 0.5, y - CAP_H / 2 + 0.5, CAP_W - 1, CAP_H - 1, CAP_H / 2 - 0.5);
      c.stroke();
    }
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
  const item = (k: IconKind, act: string, x: number, on: boolean) => {
    const hov = hovering(s, x - CAP_W / 2, y - CAP_H / 2, CAP_W, CAP_H),
      hk = clamp(hoverK(s, 'bar:' + k, !on && hov, 0.2, 1), 0, 1);
    if (hk > 0.01) pill(x, hk, true);
    icon(s, c, k, x, y, on, hk);
    addHit(s, c, { x: x - CAP_W / 2, y: y - CAP_H / 2, w: CAP_W, h: CAP_H, act });
  };
  tabs.forEach(([k, act], i) => item(k, act, x0 + BAR_L + i * BAR_STEP, s.tab === k));
  right.forEach(([k, act, x]) => item(k, act, x, k === 'gear' && s.tab === 'settings'));
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
const SPLIT = 0.53;
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
  if (ev === 'attention' || ev === 'question' || ev === 'success' || ev === 'error') return true;
  // a red CI in focus keeps the big card after its event: it has buttons to reach (island/ci.ts)
  return !!ciAlert(s) && effectiveFocus(s) === 'github';
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
  haloTint.k = 0;
  drawBody(s, c, X0, X1, cy0, cy1, fx);
  // mascots crossing between the card and the grid go over both
  flushLate();
}

function drawBody(s: IslandState, c: Ctx, X0: number, X1: number, cy0: number, cy1: number, fx: WorkFx | null): void {
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
    const bx1 = X1 - RAIL_W - gap,
      // on an island already open the event comes in by a sequence (island/eventIn.ts)
      dt = eventInDt(s);
    if (dt !== null) {
      // the mascots gather from where they were last frame: into the big card and the rail
      if (s.event && s.flyStart < s.event.start) startFlight(s);
      if (dt < EV_OUT) drawOldHome(s, c, X0, X1, cy0, cy1, 1 - dt / EV_OUT);
    }
    const w0 = (X1 - X0) * SPLIT - gap / 2,
      bw = dt === null ? bx1 - X0 : w0 + (bx1 - X0 - w0) * evWidthK(dt);
    seq.on = dt !== null;
    seq.textA = dt === null ? 1 : evTextA(dt);
    seq.tintA = dt === null ? 1 : evTintA(dt);
    c.save();
    if (dt === null) layer(s, c, 0);
    if (s.event && (s.event.type === 'attention' || s.event.type === 'question')) {
      if (seq.on && !shared.card) card(c, X0, cy0, bw, cy1 - cy0, false);
      withScale(s, c, X0, cy0, CARD_K, () =>
        drawAsk(s, c, X0, X0 + (bx1 - X0) / CARD_K, cy0, cy0 + (cy1 - cy0) / CARD_K, fx),
      );
    } else {
      if (!shared.card) card(c, X0, cy0, bw, cy1 - cy0, false);
      const tintC = focusTint(s, f);
      if (tintC) cardTint(c, X0, cy0, bw, cy1 - cy0, tintC.c, tintC.a * seq.tintA);
      if (seq.on) {
        cardFade.a = c.globalAlpha;
        c.globalAlpha *= seq.textA;
      }
      bigFocus(s, c, f, X0, cy0, bx1, cy1, fx);
      cardFade.a = -1;
    }
    seq.on = false;
    c.restore();
    c.save();
    if (dt === null) layer(s, c, 1);
    drawRail(
      s,
      c,
      X1 - RAIL_W,
      X1,
      cy0,
      cy1,
      modules(s).filter((m) => m.id !== f),
      dt,
    );
    c.restore();
    return;
  }
  if (f === 'music') {
    c.save();
    layer(s, c, 0);
    cardFade.a = c.globalAlpha;
    c.globalAlpha *= k;
    c.translate((1 - k) * 8, 0);
    // the player grows with the island like the other cards, instead of spreading its rows apart
    withScale(s, c, X0, cy0, CARD_K, () =>
      drawMusicWide(s, c, X0, X0 + (X1 - RAIL_W - gap - X0) / CARD_K, cy0, cy0 + (cy1 - cy0) / CARD_K),
    );
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
    cardFade.a = -1;
    return;
  }
  const split = X0 + (X1 - X0) * SPLIT;
  c.save();
  layer(s, c, 0);
  if (!shared.card) card(c, X0, cy0, split - X0 - gap / 2, cy1 - cy0, false);
  const tintC = focusTint(s, f);
  if (tintC) cardTint(c, X0, cy0, split - X0 - gap / 2, cy1 - cy0, tintC.c, tintC.a);
  c.save();
  cardFade.a = c.globalAlpha;
  c.globalAlpha *= k;
  c.translate((1 - k) * 8, 0);
  bigFocus(s, c, f, X0, cy0, split - gap / 2, cy1, fx);
  cardFade.a = -1;
  c.restore();
  c.restore();
  // the other modules: Grok Bot's grid - one card, a 2 × 2 of pills, each a small mascot in its
  // colour and the name. The state is the mascot's mood and the pill's rim, not words: the focus
  // card on the left is where the reading happens
  const items = modules(s)
    .filter((m) => m.id !== f)
    .slice(0, 4);
  const g = grid(X0, X1, cy0, cy1, items.length);
  c.save();
  layer(s, c, 1);
  card(c, g.x0, cy0, g.w, cy1 - cy0, false);
  c.restore();
  items.forEach((it, i) => {
    c.save();
    layer(s, c, 1 + i);
    const p = g.pill(i);
    modulePill(s, c, it, i, p.x, p.y, g.pw, g.ph);
    c.restore();
  });
  const picked = modules(s).find((m) => m.id === f);
  if (picked) ghostPill(s, c, picked);
}

/** a module as a pill: a dark fill tinted with its colour, a rim of it, its mascot and the name */
function modulePill(
  s: IslandState,
  c: Ctx,
  it: ModuleItem,
  i: number,
  px: number,
  py: number,
  pw: number,
  ph: number,
): void {
  const col = MODULE_COL[it.id].body,
    hov = hovering(s, px, py, pw, ph),
    hot = isHot(it);
  // a focus change: the pill slides from its old slot, one after another (island/flight.ts)
  const fb = flyBox(s, c, it.id, i, px, py, pw, ph),
    { x, y, w, h } = fb || { x: px, y: py, w: pw, h: ph };
  markBox(s, c, it.id, x, y, w, h);
  // coucou's chip hover: lifts to 1.04 on a spring, the fill and rim take the module colour, a
  // glow of it comes up behind (2026-10-19)
  const k = hoverK(s, 'pill:' + it.id, hov),
    ka = clamp(k, 0, 1),
    sc = (1 + 0.04 * k) * pressScale(s, 'focus:' + it.id),
    a0 = c.globalAlpha;
  c.save();
  c.globalAlpha *= newPillA(s, it.id);
  c.translate(x + w / 2, y + h / 2);
  c.scale(sc, sc);
  c.translate(-(x + w / 2), -(y + h / 2));
  pillPlate(c, x, y, w, h, col, hot, ka);
  const mx = x + 8 + h * 0.25,
    my = y + h / 2 + 0.5,
    mR = h * 0.25,
    mini = { ...miniFor(it), body: deepCol(col) },
    // the module that just left focus: its mascot shrinks in from the card, its pill comes up under it
    fl = flyMascot(s, c, it.id, mx, my, mR);
  if (fl) drawLate(c, () => drawMini(s, c, fl.x, fl.y, fl.R, mini), a0);
  else drawMini(s, c, mx, my, mR, mini);
  markSpot(s, c, it.id, fl ? fl.x : mx, fl ? fl.y : my, fl ? fl.R : mR);
  pillName(c, it.name, x, y, w, h, col, ka);
  c.restore();
  addHit(s, c, { x: px, y: py, w: pw, h: ph, act: 'focus:' + it.id });
}

/** a pill's plate: a dark fill tinted with the module colour and a rim of it; ka - hover */
function pillPlate(c: Ctx, x: number, y: number, w: number, h: number, col: string, hot: boolean, ka: number): void {
  const r = h / 2;
  if (ka > 0.01) {
    c.save();
    c.shadowColor = hexA(deepCol(col), 0.5 * ka);
    c.shadowBlur = 14 * c.getTransform().a;
    rrect(c, x, y, w, h, r);
    c.fillStyle = '#0B0B0C';
    c.fill();
    c.restore();
  }
  rrect(c, x, y, w, h, r);
  c.fillStyle = '#0B0B0C';
  c.fill();
  c.fillStyle = hexA(deepCol(col), 0.1 + 0.12 * ka);
  c.fill();
  c.lineWidth = 1;
  c.strokeStyle = hexA(col, (hot ? 0.34 : 0.16) + 0.36 * ka);
  rrect(c, x + 0.5, y + 0.5, w - 1, h - 1, r - 0.5);
  c.stroke();
}

function pillName(c: Ctx, name: string, x: number, y: number, w: number, h: number, col: string, ka: number): void {
  const tx = x + 12 + h * 0.5;
  textAt(c, name, tx, y + h / 2 + 0.5, {
    size: 12.5,
    color: mixWhite(col, 0.45 + 0.25 * ka),
    max: w - (tx - x) - 8,
  });
}

/** the pill just picked: its mascot lifts out and flies to the card, the plate and name it leaves
 * fade and settle back a little instead of vanishing in one frame */
const GHOST = 0.16;
function ghostPill(s: IslandState, c: Ctx, it: ModuleItem): void {
  const b = s.flyBoxFrom[it.id],
    dt = flyDt(s);
  if (!b || dt >= GHOST || !s.flyFrom[it.id]) return;
  const k = dt / GHOST,
    p = toLocal(c, b.x, b.y),
    w = b.w / p.k,
    h = b.h / p.k,
    col = MODULE_COL[it.id].body,
    sc = 1 - 0.04 * k;
  c.save();
  c.globalAlpha *= 1 - k;
  c.translate(p.x + w / 2, p.y + h / 2);
  c.scale(sc, sc);
  c.translate(-(p.x + w / 2), -(p.y + h / 2));
  pillPlate(c, p.x, p.y, w, h, col, false, 0);
  pillName(c, it.name, p.x, p.y, w, h, col, 0);
  c.restore();
}

/** home's right half: one card holding a 2 × 2 of pills */
function grid(X0: number, X1: number, cy0: number, cy1: number, n: number) {
  const gap = 8,
    x0 = X0 + (X1 - X0) * SPLIT + gap / 2,
    w = X1 - x0,
    pad = 10,
    pg = 8,
    pw = (w - pad * 2 - pg) / 2,
    // the pills fill their card (they floated in it at 34 px, with 40 px of nothing above and below)
    ph = Math.min(48, (cy1 - cy0 - pad * 2 - pg) / 2),
    rows = Math.ceil(n / 2),
    py0 = cy0 + (cy1 - cy0 - (rows * ph + (rows - 1) * pg)) / 2;
  return {
    x0,
    w,
    pw,
    ph,
    pill: (i: number) => ({ x: x0 + pad + (i % 2) * (pw + pg), y: py0 + Math.floor(i / 2) * (ph + pg) }),
  };
}

/** home as it was before an event took the big card, fading out (alpha a): the old focus card's
 * text and the pills' plates and names. Their mascots are not drawn: they are flying to the big
 * card and the rail. Takes no clicks. */
function drawOldHome(s: IslandState, c: Ctx, X0: number, X1: number, cy0: number, cy1: number, a: number): void {
  const f0 = s.prevFocus;
  if (!f0 || f0 === 'music' || !modules(s).some((m) => m.id === f0)) return;
  const items = modules(s)
      .filter((m) => m.id !== f0)
      .slice(0, 4),
    g = grid(X0, X1, cy0, cy1, items.length),
    n = s.hits.length,
    spots = { ...s.flySpots };
  c.save();
  c.globalAlpha *= a;
  cardFade.hide = true;
  drawLeaving(() => bigFocus(s, c, f0, X0, cy0, X0 + (X1 - X0) * SPLIT - 4, cy1, null));
  cardFade.hide = false;
  card(c, g.x0, cy0, g.w, cy1 - cy0, false);
  items.forEach((it, i) => {
    const p = g.pill(i),
      col = MODULE_COL[it.id].body;
    pillPlate(c, p.x, p.y, g.pw, g.ph, col, isHot(it), 0);
    pillName(c, it.name, p.x, p.y, g.pw, g.ph, col, 0);
  });
  c.restore();
  s.hits.length = n;
  s.flySpots = spots;
}

/** a module colour lifted toward white, for text on its own tint */
function mixWhite(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16),
    m = (v: number) => Math.round(v + (255 - v) * k);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}
