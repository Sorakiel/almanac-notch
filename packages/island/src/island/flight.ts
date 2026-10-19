import type { Ctx } from '../util/draw';
import type { IslandState, ModuleId } from '../sim/state';
import { springK } from './reveal';

// Focus change (docs/CHANGES.md 2026-10-19): the same mascot never vanishes and reappears, it
// travels - the picked one grows out of its pill into the focus card, the one that leaves focus
// shrinks into its new pill, the other pills slide to their new slots one after another. After
// Grok Bot (Novra, clip 11/11); coucou moves the mascot but swaps its chip grid in one frame.

/** a point and a size in device pixels, stamped with the frame time it was drawn at */
export interface Spot {
  x: number;
  y: number;
  R: number;
  t: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  t: number;
}

/** the flight's spring: Grok Bot's spring(0.40, 0.88). coucou's 0.8 overshoots ~8 px over a
 * card-to-pill path and the mascot lands on the pill's name */
export const FLY_RESPONSE = 0.4;
export const FLY_DAMPING = 0.88;
/** the pills start one after another this far apart */
export const PILL_STEP = 0.03;
/** past this the flight is over and nothing is interpolated */
const FLY_END = 0.9;

/** local (x, y) → device pixels under the current transform */
export function toDevice(c: Ctx, x: number, y: number): { x: number; y: number; k: number } {
  const m = c.getTransform();
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, k: Math.hypot(m.a, m.b) };
}

/** device pixels → local (x, y) under the current transform */
export function toLocal(c: Ctx, x: number, y: number): { x: number; y: number; k: number } {
  const m = c.getTransform(),
    det = m.a * m.d - m.b * m.c,
    dx = x - m.e,
    dy = y - m.f;
  return { x: (m.d * dx - m.c * dy) / det, y: (m.a * dy - m.b * dx) / det, k: Math.hypot(m.a, m.b) };
}

/** remember where module `id`'s mascot is drawn this frame */
export function markSpot(s: IslandState, c: Ctx, id: ModuleId, x: number, y: number, R: number): void {
  const p = toDevice(c, x, y);
  s.flySpots[id] = { x: p.x, y: p.y, R: R * p.k, t: s.t };
}

/** remember where module `id`'s pill is drawn this frame */
export function markBox(s: IslandState, c: Ctx, id: ModuleId, x: number, y: number, w: number, h: number): void {
  const p = toDevice(c, x, y);
  s.flyBoxes[id] = { x: p.x, y: p.y, w: w * p.k, h: h * p.k, t: s.t };
}

/** the focus changed: freeze last frame's spots and boxes as the flights' starting points */
export function startFlight(s: IslandState): void {
  // twice in one frame (the focus and an event change together): the first froze last frame's spots
  if (s.flyStart === s.t) return;
  s.flyStart = s.t;
  const fresh = <T extends { t: number }>(m: Partial<Record<ModuleId, T>>) => {
    const o: Partial<Record<ModuleId, T>> = {};
    for (const [id, v] of Object.entries(m) as [ModuleId, T][]) if (v && s.t - v.t < 0.1) o[id] = v;
    return o;
  };
  s.flyFrom = fresh(s.flySpots);
  s.flyBoxFrom = fresh(s.flyBoxes);
}

/** progress of a flight that starts `delay` after the focus change; 1 when there is none */
function flyK(s: IslandState, delay = 0): number {
  const dt = s.t - s.flyStart - delay;
  return dt >= FLY_END ? 1 : springK(dt, FLY_RESPONSE, FLY_DAMPING);
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** where module `id`'s mascot is drawn now, on its way from its last spot to (x, y, R) */
export function flyMascot(
  s: IslandState,
  c: Ctx,
  id: ModuleId,
  x: number,
  y: number,
  R: number,
  delay = 0,
): { x: number; y: number; R: number; k: number } | null {
  const from = s.flyFrom[id];
  if (!from || s.t - s.flyStart >= FLY_END + delay) return null;
  const p = toLocal(c, from.x, from.y),
    k = flyK(s, delay);
  return { x: mix(p.x, x, k), y: mix(p.y, y, k), R: mix(from.R / p.k, R, k), k };
}

/** where module `id`'s pill is drawn now, sliding from its last slot; null when it had none */
export function flyBox(
  s: IslandState,
  c: Ctx,
  id: ModuleId,
  i: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  const from = s.flyBoxFrom[id];
  if (!from || s.t - s.flyStart >= FLY_END + i * PILL_STEP) return null;
  const p = toLocal(c, from.x, from.y),
    k = flyK(s, i * PILL_STEP);
  return { x: mix(p.x, x, k), y: mix(p.y, y, k), w: mix(from.w / p.k, w, k), h: mix(from.h / p.k, h, k) };
}

/** a pill that had no slot before (the module that just left focus): its plate comes up once its
 * mascot is nearly home, so the mascot is seen arriving rather than appearing inside a ready pill */
export function newPillA(s: IslandState, id: ModuleId): number {
  if (s.flyBoxFrom[id] || !s.flyFrom[id]) return 1;
  const dt = s.t - s.flyStart;
  return Math.max(0, Math.min(1, (dt - 0.2) / 0.2));
}

/** the focus card's alpha before its content fade-in: a flying mascot is already there, it does
 * not fade in with the text (-1: no fade around the card being drawn) */
export const cardFade = { a: -1, hide: false };

/** seconds since the last flight began */
export const flyDt = (s: IslandState): number => s.t - s.flyStart;

/** draws that must sit on top of the whole home view (a mascot crossing from card to grid) */
const late: Array<() => void> = [];
export function drawLate(c: Ctx, draw: () => void, alpha = c.globalAlpha): void {
  const m = c.getTransform(),
    a = alpha;
  late.push(() => {
    c.save();
    c.setTransform(m);
    c.globalAlpha = a;
    draw();
    c.restore();
  });
}
export function flushLate(): void {
  for (const f of late.splice(0)) f();
}
