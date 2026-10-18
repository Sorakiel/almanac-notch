import { describe, expect, it } from 'vitest';
import { GRAV, GROUP, SPRING_STEP, Spring, createSprings, kz, type SpringName } from './springs';
import { defaultSettings } from './settings';
import { createState } from './state';
import { mulberry32 } from './rng';
import { stepSprings } from './behavior';

const S = defaultSettings();

function settle(k: number, z: number, secs = 3) {
  const sp = new Spring(0);
  sp.t = 1;
  let max = 0;
  for (let i = 0; i < secs / SPRING_STEP; i++) {
    sp.step(SPRING_STEP, k, z);
    max = Math.max(max, sp.x);
  }
  return { x: sp.x, v: sp.v, max };
}

describe('Spring', () => {
  it('is semi-implicit Euler with c = 2ζ√k', () => {
    const sp = new Spring(0.3);
    sp.v = -1.2;
    sp.t = 1;
    const h = 1 / 240,
      k = 320,
      z = 0.42;
    const v = -1.2 + (-k * (0.3 - 1) - 2 * z * Math.sqrt(k) * -1.2) * h;
    sp.step(h, k, z);
    expect(sp.v).toBe(v);
    expect(sp.x).toBe(0.3 + v * h);
  });

  it('settles on the target for every group', () => {
    for (const name of Object.keys(createSprings()) as SpringName[]) {
      const [k, z] = kz(S, name);
      const r = settle(k, z, 6);
      expect(r.x, name).toBeCloseTo(1, 3);
    }
  });

  it('overshoots when underdamped and not when critically damped', () => {
    expect(settle(...kz(S, 'posX')).max).toBeGreaterThan(1.2); // body ζ 0.42
    expect(settle(...kz(S, 'badge')).max).toBeGreaterThan(1.05); // badge ζ 0.6
    expect(settle(...kz(S, 'halfA')).max).toBeLessThanOrEqual(1); // fade ζ 1
    expect(settle(...kz(S, 'spin')).max).toBeLessThanOrEqual(1);
  });
});

describe('spring groups (docs/SPEC.md 1.3)', () => {
  it('match the table', () => {
    const table: [SpringName, number, number][] = [
      ['posX', 320, 0.42],
      ['sq', 320, 0.42],
      ['lean', 320, 0.42],
      ['lookX', 260, 0.78],
      ['lookY', 260, 0.78],
      ['happy', 200, 0.85],
      ['hide', 200, 0.85],
      ['hand', 200, 0.85],
      ['lid', 1600, 0.9],
      ['glow', 40, 0.95],
      ['earL', 190, 0.78],
      ['nw', 190, 0.78],
      ['badge', 260, 0.6],
      ['halfA', 160, 1],
      ['alertA', 160, 1],
      ['spin', 70, 1],
    ];
    for (const [name, k, z] of table) expect(kz(S, name), name).toEqual([k, z]);
  });

  it('follow the tuning sliders', () => {
    const S2 = { ...S, bodyK: 500, bodyZ: 0.3, eyeK: 100, eyeZ: 0.5, exprK: 90, exprZ: 0.6 };
    expect(kz(S2, 'sq')).toEqual([500, 0.3]);
    expect(kz(S2, 'lookY')).toEqual([100, 0.5]);
    expect(kz(S2, 'puff')).toEqual([90, 0.6]);
    expect(GROUP.puff).toBeUndefined();
  });
});

describe('posY', () => {
  it('falls under gravity, squashes on landing and bounces when fast', () => {
    const s = createState(defaultSettings(), mulberry32(1), 0);
    s.sp.posY.v = -6;
    let landedV = 0;
    for (let i = 0; i < 240; i++) {
      const prevV = s.sp.posY.v;
      const sqv = s.sp.sq.v;
      stepSprings(s, SPRING_STEP, false);
      if (s.sp.posY.x === 0 && prevV > 0 && landedV === 0) {
        landedV = prevV + GRAV * SPRING_STEP;
        expect(s.sp.posY.v).toBeCloseTo(-landedV * 0.16, 6);
        expect(s.sp.sq.v).toBeLessThan(sqv);
      }
    }
    expect(landedV).toBeGreaterThan(4);
  });

  it('a jump of power p peaks at p²/(2·GRAV)', () => {
    const s = createState(defaultSettings(), mulberry32(1), 0);
    s.sp.posY.v = -5;
    let top = 0;
    for (let i = 0; i < 120; i++) {
      stepSprings(s, SPRING_STEP, false);
      top = Math.min(top, s.sp.posY.x);
    }
    expect(-top).toBeCloseTo(25 / (2 * GRAV), 1);
  });
});
