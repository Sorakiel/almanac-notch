import type { IslandState } from '../sim/state';
import { clamp, ss } from '../util/math';
import { springK } from './reveal';

// An event taking the big card on an island that is already open (permission, question, done,
// error) comes in sequence, not in one frame (docs/CHANGES.md 2026-10-19). Order and timings after
// Grok Bot (Novra, clip 11/10, docs/polish-refs/README.md table 9b): the old view fades in ~0.1 s,
// the big card widens on spring(0.40, 0.88), the text comes up at t50 ≈ 0.43 s, the state's glow
// last at t90 ≈ 0.53 s; the mascots gather into the rail one after another (island/flight.ts).

/** the old view fades out in this long */
export const EV_OUT = 0.1;
/** the sequence is over by then */
const EV_END = 1;

/** seconds since the event began, while it is coming in on an island that was already open; null
 * when there is no sequence (no event, it is over, or the event opened the island - the reveal
 * layers it then, island/reveal.ts) */
export function eventInDt(s: IslandState): number | null {
  const ev = s.event;
  if (!ev) return null;
  const dt = s.t - ev.start;
  if (dt < 0 || dt >= EV_END || s.revealStart > ev.start - 0.05) return null;
  return dt;
}

/** the big card's width, 0 (the focus card's) → 1 (all but the rail); starts once the old view is
 * mostly gone: t50 ≈ 0.20 s, t90 ≈ 0.31 s, no overshoot */
export const evWidthK = (dt: number): number => springK(dt - 0.06, 0.4, 0.88);
/** the card's text: t50 ≈ 0.43 s */
export const evTextA = (dt: number): number => ss(0.33, 0.53, dt);
/** the state's glow at the card's rim, last: t90 ≈ 0.53 s */
export const evTintA = (dt: number): number => ss(0.38, 0.58, dt);
/** the rail's plate comes up under the gathering mascots */
export const evRailA = (dt: number): number => ss(0.06, 0.26, dt);
/** a rail mascot with nowhere to fly from slides in from the right, one after another */
export const evSlideK = (dt: number, i: number): number => {
  const k = clamp((dt - 0.14 - i * 0.05) / 0.26, 0, 1);
  return 1 - (1 - k) ** 3;
};

/** what drawAsk and the card mascot read while the sequence runs */
export const seq = { on: false, textA: 1, tintA: 1 };
