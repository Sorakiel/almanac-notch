// Depth inside a module card (stage 10, docs/polish-refs/README.md): the card -> a list that
// scrolls -> one item -> an action -> back. One mechanism for every module: a module only says
// what a level shows; the levels, their transition, the scroll and the way back live here.
import { clamp, ss } from '../util/math';
import { textAt, type Ctx } from '../util/draw';
import type { IslandState, ModuleId } from '../sim/state';
import { addHit, hovering, withShift } from './hits';
import { hoverK } from './hover';

/** how far a level slides while it comes in or leaves, px: enough to read as "deeper", short
 * enough that the text stays readable all the way */
const SHIFT = 14;
/** spring of a level change: ~0.25 s, next to no overshoot in a small card */
const LEVEL_RESPONSE = 0.32,
  LEVEL_DAMPING = 0.9;
/** the list follows the wheel on a critically damped spring: smooth with a mouse that steps */
const SCROLL_RESPONSE = 0.2;
/** past an end the wheel moves the list this much less, up to RUBBER px, then it springs back */
const RESIST = 0.3,
  RUBBER = 22,
  /** the wheel has let go after this long (s): an overscroll springs back */
  WHEEL_REST = 0.12;
/** a two-finger swipe this far to the right (px) within SWIPE_WINDOW s goes back */
const SWIPE_BACK = 70,
  SWIPE_WINDOW = 0.35;

/** progress 0 -> 1 of a step on a spring `response` s with `damping` < 1, `t` s after it began */
export function springStep(t: number, response = LEVEL_RESPONSE, damping = LEVEL_DAMPING): number {
  if (t <= 0) return 0;
  const w = (2 * Math.PI) / response,
    wd = w * Math.sqrt(1 - damping * damping);
  const x =
    1 -
    Math.exp(-damping * w * t) * (Math.cos(wd * t) + (damping / Math.sqrt(1 - damping * damping)) * Math.sin(wd * t));
  return t > response * 3 ? 1 : x;
}

/** the level shown for module `mod`: '' its card, else the deepest one */
export function depthTop(s: IslandState, mod: ModuleId): string {
  const d = s.depth;
  return d.mod === mod ? (d.stack[d.stack.length - 1] ?? '') : '';
}

/** go one level deeper in `mod`'s card */
export function depthPush(s: IslandState, mod: ModuleId, key: string): void {
  const d = s.depth;
  if (d.mod !== mod) {
    d.mod = mod;
    d.stack = [];
  }
  if (d.stack[d.stack.length - 1] === key) return;
  d.from = d.stack[d.stack.length - 1] ?? '';
  d.stack.push(key);
  d.dir = 1;
  d.at = s.t;
  // the mascot notices the move: a blink, as when its eyes follow something new
  s.blinkUntil = s.t + 0.07;
}

/** one level back; false when the card was already at its top */
export function depthBack(s: IslandState): boolean {
  const d = s.depth;
  if (!d.stack.length) return false;
  d.from = d.stack.pop() as string;
  d.dir = -1;
  d.at = s.t;
  return true;
}

/** back to the card at once, no transition: the island closed or the focus moved on - the
 * next look at a card starts from its summary, not from a list left open earlier */
export function depthReset(s: IslandState): void {
  const d = s.depth;
  d.mod = null;
  d.stack = [];
  d.from = null;
  d.scroll = {};
}

/**
 * Draw `mod`'s card at its current level. During a change the old level slides out to one side
 * and fades, the new one slides in from the other: in from the right, back from the left - the
 * direction says where you are. `draw(key)` draws one level ('' = the card).
 */
export function drawDepth(s: IslandState, c: Ctx, mod: ModuleId, draw: (key: string) => void): void {
  const d = s.depth;
  // another module's card (one fading out on a focus change) shows its summary
  const top = depthTop(s, mod);
  const k = d.from === null || d.mod !== mod ? 1 : springStep(s.t - d.at);
  if (k >= 1) {
    d.from = null;
    draw(top);
    return;
  }
  const from = d.from as string;
  // the old level is nearly gone before the new one shows: the two never read on top of each
  // other (the order of the tab change: what leaves, then what comes)
  c.save();
  c.globalAlpha *= 1 - ss(0, 0.35, k);
  withShift(s, c, -d.dir * SHIFT * k, 0, () => draw(from));
  c.restore();
  c.save();
  c.globalAlpha *= ss(0.25, 1, k);
  withShift(s, c, d.dir * SHIFT * (1 - k), 0, () => draw(top));
  c.restore();
}

/**
 * A level's head, as coucou's mail message head: a quiet grey chevron (the way out), a dot of the
 * item's colour, the title in 11.5 semibold; chevron, dot and title are one button. `dot` null
 * leaves the dot out. Returns the right edge.
 */
export function backHead(
  s: IslandState,
  c: Ctx,
  title: string,
  x: number,
  y: number,
  max: number,
  dot: string | null = null,
): number {
  const tx = x + 14 + (dot ? 10 : 0);
  c.save();
  c.font = '600 11.5px Onest, system-ui, sans-serif';
  const tw = Math.min(c.measureText(title).width, Math.max(10, x + max - tx));
  c.restore();
  const w = tx - x + tw + 6,
    hov = clamp(hoverK(s, 'depth:back', hovering(s, x - 6, y - 10, w + 6, 20), 0.16, 1), 0, 1);
  c.save();
  // grey at rest, it lights up and leans left a touch under the pointer: it is the way out
  c.strokeStyle = hov > 0.5 ? '#C5C8CD' : '#6B7079';
  c.lineWidth = 1.5;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  const nx = x + 3 - 1.2 * hov;
  c.moveTo(nx + 2.5, y - 4);
  c.lineTo(nx - 1.5, y);
  c.lineTo(nx + 2.5, y + 4);
  c.stroke();
  c.restore();
  if (dot) {
    c.fillStyle = dot;
    c.beginPath();
    c.arc(x + 17, y, 3, 0, Math.PI * 2);
    c.fill();
  }
  textAt(c, title, tx, y + 0.5, { size: 11.5, weight: 600, color: '#F5F6F8', max: Math.max(10, x + max - tx) });
  addHit(s, c, { x: x - 6, y: y - 10, w: w + 6, h: 20, act: 'depth:back' });
  return x + w;
}

/**
 * A list in a window of `vh` px at (x, y): `n` rows `rowH` apart scroll inside it. Rows leave and
 * enter through a short fade where the list goes on, so an edge with more behind it reads as such;
 * a row is clickable only when it is fully in (addHit's alpha rule). `row(i, cy)` draws row i
 * centred at cy.
 */
export function scrollList(
  s: IslandState,
  c: Ctx,
  key: string,
  x: number,
  y: number,
  w: number,
  vh: number,
  n: number,
  rowH: number,
  row: (i: number, cy: number) => void,
): void {
  const max = Math.max(0, n * rowH - vh + 4);
  const sc = scrollOf(s, key, max);
  const off = sc.y;
  // the wheel finds this list by its zone (islandWheel), under the rows' own zones
  addHit(s, c, { x, y, w, h: vh, act: 'scroll:' + key });
  c.save();
  c.beginPath();
  c.rect(x - 8, y, w + 16, vh);
  c.clip();
  const FADE = 12;
  for (let i = 0; i < n; i++) {
    const cy = y + rowH / 2 + i * rowH - off;
    if (cy < y - rowH || cy > y + vh + rowH) continue;
    // fade at an edge only where rows go on past it
    const top = off > 0.5 ? clamp((cy - y) / FADE, 0, 1) : 1,
      bottom = off < max - 0.5 ? clamp((y + vh - cy) / FADE, 0, 1) : 1;
    const a = Math.min(top, bottom);
    if (a <= 0.01) continue;
    c.save();
    c.globalAlpha *= a;
    row(i, cy);
    c.restore();
  }
  c.restore();
}

/** the scroll of list `key` this frame: it springs towards the wheel's target, past an end back */
function scrollOf(s: IslandState, key: string, max: number): { y: number } {
  const all = s.depth.scroll;
  let sc = all[key];
  if (!sc) all[key] = sc = { y: 0, v: 0, target: 0, max, wheelAt: -1, t: s.t };
  sc.max = max;
  // the wheel let go: an overscroll returns to the end; a list that shrank keeps in range
  if (s.t - sc.wheelAt > WHEEL_REST) sc.target = clamp(sc.target, 0, max);
  let dt = clamp(s.t - sc.t, 0, 0.1);
  sc.t = s.t;
  const w = (2 * Math.PI) / SCROLL_RESPONSE;
  while (dt > 0) {
    const h = Math.min(dt, 1 / 240);
    sc.v += (-w * w * (sc.y - sc.target) - 2 * w * sc.v) * h;
    sc.y += sc.v * h;
    dt -= h;
  }
  if (Math.abs(sc.y - sc.target) < 0.05 && Math.abs(sc.v) < 0.5) {
    sc.y = sc.target;
    sc.v = 0;
  }
  return sc;
}

/**
 * The wheel or a trackpad over the island (DOM wheel deltas, CSS px). Over a list it scrolls the
 * list; a sideways two-finger swipe to the right goes back a level. True when it was used.
 */
export function islandWheel(s: IslandState, p: { x: number; y: number }, dx: number, dy: number): boolean {
  const d = s.depth;
  // the swipe back: mostly sideways, to the right, far enough within a short time
  if (Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (s.t - d.swipe.at > SWIPE_WINDOW) d.swipe = { dx: 0, at: s.t };
    d.swipe.dx += dx;
    if (d.swipe.dx < -SWIPE_BACK && d.stack.length) {
      d.swipe = { dx: 0, at: -1 };
      depthBack(s);
      return true;
    }
    return d.stack.length > 0;
  }
  const zone = listAt(s, p);
  if (!zone) return false;
  const sc = d.scroll[zone];
  if (!sc) return false;
  // a mouse wheel steps ~100 px a notch: one notch moves about a row and a half, a trackpad's
  // small deltas pass as they are
  const step = Math.sign(dy) * Math.min(Math.abs(dy), 32);
  // the part of a step that goes past an end meets resistance, the rest moves freely
  let next = sc.target + step;
  if (next > sc.max) {
    const from = Math.max(sc.target, sc.max);
    next = from + (next - from) * RESIST;
  } else if (next < 0) {
    const from = Math.min(sc.target, 0);
    next = from + (next - from) * RESIST;
  }
  sc.target = clamp(next, -RUBBER, sc.max + RUBBER);
  sc.wheelAt = s.t;
  return true;
}

/** the list under the point: its scroll zone, even under a row's own zone */
function listAt(s: IslandState, p: { x: number; y: number }): string | null {
  for (let i = s.hits.length - 1; i >= 0; i--) {
    const h = s.hits[i];
    if (h && h.act.startsWith('scroll:') && p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h)
      return h.act.slice(7);
  }
  return null;
}

/** The mouse's back button, Esc in the browser: one level back. */
export function islandBack(s: IslandState): boolean {
  return depthBack(s);
}

/** a click: true when it was a depth control ("depth:back", "depth:<mod>:<key>") */
export function depthAct(s: IslandState, act: string): boolean {
  if (act === 'depth:back') return (depthBack(s), true);
  if (!act.startsWith('depth:')) return false;
  const rest = act.slice(6),
    i = rest.indexOf(':');
  if (i < 0) return false;
  depthPush(s, rest.slice(0, i) as ModuleId, rest.slice(i + 1));
  return true;
}
