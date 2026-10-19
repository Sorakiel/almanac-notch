// Hover and press as springs, not as a switch (docs/CHANGES.md 2026-10-19). The numbers are
// coucou's: hover spring(response 0.2, damping 0.7) - quick, with a small overshoot that makes the
// thing under the pointer feel picked up; a press sinks to 0.94 and springs back.
import { clamp } from '../util/math';
import type { IslandState } from '../sim/state';

interface Sp {
  x: number;
  v: number;
  last: number;
}
const springs = new WeakMap<IslandState, Map<string, Sp>>();

/** 0 → 1 while `on`, through a spring; may overshoot a little above 1 */
export function hoverK(s: IslandState, id: string, on: boolean, response = 0.2, damping = 0.7): number {
  let m = springs.get(s);
  if (!m) springs.set(s, (m = new Map()));
  let sp = m.get(id);
  if (!sp) m.set(id, (sp = { x: on ? 1 : 0, v: 0, last: s.t }));
  const w = (2 * Math.PI) / response,
    k = w * w,
    c = 2 * damping * w,
    target = on ? 1 : 0;
  let dt = clamp(s.t - sp.last, 0, 0.1);
  sp.last = s.t;
  while (dt > 0) {
    const h = Math.min(dt, 1 / 240);
    sp.v += (-k * (sp.x - target) - c * sp.v) * h;
    sp.x += sp.v * h;
    dt -= h;
  }
  return sp.x;
}

/** scale of a pressed control: down to 0.94 within 80 ms of the click, back over 0.22 s */
export function pressScale(s: IslandState, act: string): number {
  if (s.pressAct !== act) return 1;
  const t = s.t - s.pressAt;
  if (t < 0 || t > 0.3) return 1;
  const dip = t < 0.08 ? t / 0.08 : 1 - (t - 0.08) / 0.22;
  return 1 - 0.06 * clamp(dip, 0, 1);
}
