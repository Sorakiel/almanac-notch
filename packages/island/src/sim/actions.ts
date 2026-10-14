import { after, type IslandState } from './state';

/** proto: hop - crouch for 0.11 s, then jump */
export function hop(s: IslandState, power: number): void {
  if (s.grab && s.grab.active) return;
  s.sqOverride = { val: 0.8, until: s.t + 0.11 };
  after(s, 0.11, () => {
    if (s.grab && s.grab.active) return;
    s.sp.posY.v = Math.min(s.sp.posY.v, 0) - power;
    s.sp.sq.v += power * 1.4;
  });
}

/** proto: wake */
export function wake(s: IslandState, startle: boolean): void {
  s.sleeping = false;
  s.forcedSleep = false;
  if (startle) {
    s.sp.wide.v += 7;
    hop(s, 3.6);
  }
  s.notify();
}

/** proto: poke - lx, ly in body units; 3 pokes in 1.6 s sulk, 6 overload */
export function poke(s: IslandState, lx: number, ly: number): void {
  const { sp, t } = s;
  const f = s.S.pokeForce;
  if (s.sleeping) {
    wake(s, true);
    return;
  }
  sp.sq.v -= 4.5 * f;
  sp.posX.v += -lx * 2.4 * f;
  sp.lean.v += -lx * 7 * f * (ly < 0 ? 1 : 0.5);
  s.squintUntil = t + 0.2;
  s.pokes = s.pokes.filter((p) => t - p < 1.6);
  s.pokes.push(t);
  if (s.overloadUntil > t) return;
  if (s.pokes.length >= 6) {
    s.overloadUntil = t + 3.2;
    s.grumpyUntil = 0;
    s.pokes = [];
    s.glowColor = '#FF5FA2';
    sp.sq.v -= 3;
    sp.lean.v += 2.5;
  } else if (s.pokes.length >= 3) s.grumpyUntil = t + 2.6;
}
