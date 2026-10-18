import type { Settings } from './settings';

/** proto: Spring - semi-implicit Euler, c = 2ζ√k */
export class Spring {
  x: number;
  v = 0;
  t: number;
  constructor(x: number) {
    this.x = x;
    this.t = x;
  }
  step(h: number, k: number, z: number): void {
    const c = 2 * z * Math.sqrt(k);
    this.v += (-k * (this.x - this.t) - c * this.v) * h;
    this.x += this.v * h;
  }
}

/** proto: sp (key order kept: it is the stepping order) */
export function createSprings() {
  return {
    posX: new Spring(0),
    posY: new Spring(0),
    sq: new Spring(1),
    lean: new Spring(0),
    lookX: new Spring(0),
    lookY: new Spring(0),
    happy: new Spring(0),
    grump: new Spring(0),
    wide: new Spring(0),
    hide: new Spring(0),
    puff: new Spring(0),
    hand: new Spring(0),
    work: new Spring(0),
    think: new Spring(0),
    lid: new Spring(1),
    glow: new Spring(0),
    badge: new Spring(0),
    earL: new Spring(0),
    earR: new Spring(0),
    ih: new Spring(32),
    nw: new Spring(190),
    halfA: new Spring(0),
    openA: new Spring(0),
    alertA: new Spring(0),
    spin: new Spring(0),
  };
}
export type Springs = ReturnType<typeof createSprings>;
export type SpringName = keyof Springs;

type Group = 'body' | 'eye' | 'fast' | 'slow' | 'island' | 'badge' | 'fade' | 'spin';

/** proto: GROUP - springs not listed use the expr group */
export const GROUP: Partial<Record<SpringName, Group>> = {
  posX: 'body',
  sq: 'body',
  lean: 'body',
  lookX: 'eye',
  lookY: 'eye',
  lid: 'fast',
  glow: 'slow',
  earL: 'island',
  earR: 'island',
  ih: 'island',
  nw: 'island',
  halfA: 'fade',
  openA: 'fade',
  alertA: 'fade',
  spin: 'spin',
  badge: 'badge',
};

/** proto: kz - stiffness and damping ratio of a spring */
export function kz(S: Settings, name: SpringName): [number, number] {
  switch (GROUP[name]) {
    case 'body':
      return [S.bodyK, S.bodyZ];
    case 'eye':
      return [S.eyeK, S.eyeZ];
    case 'fast':
      return [1600, 0.9];
    case 'slow':
      return [40, 0.95];
    case 'island':
      return [190, 0.78];
    case 'badge':
      return [260, 0.6];
    case 'fade':
      return [160, 1];
    case 'spin':
      return [70, 1];
    default:
      return [S.exprK, S.exprZ];
  }
}

/** proto: GRAV - R per s², posY falls instead of springing */
export const GRAV = 34;

/** proto: fixed spring substep in update */
export const SPRING_STEP = 1 / 240;
