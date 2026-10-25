import { describe, expect, it } from 'vitest';
import { createState } from '../sim/state';
import { defaultSettings } from '../sim/settings';
import { mulberry32, PARITY_SEED } from '../sim/rng';
import { depthAct, depthBack, depthTop, islandWheel, springStep } from './depth';

function make() {
  const s = createState(defaultSettings(), mulberry32(PARITY_SEED), 0);
  s.t = 10;
  return s;
}

describe('levels inside a card', () => {
  it('goes in and back, one level at a time', () => {
    const s = make();
    expect(depthTop(s, 'almanac')).toBe('');
    expect(depthAct(s, 'depth:almanac:item:a')).toBe(true);
    expect(depthTop(s, 'almanac')).toBe('item:a');
    expect(depthTop(s, 'github')).toBe('');
    expect(s.depth.dir).toBe(1);
    expect(depthAct(s, 'depth:back')).toBe(true);
    expect(depthTop(s, 'almanac')).toBe('');
    expect(s.depth.dir).toBe(-1);
    expect(depthBack(s)).toBe(false);
    expect(depthAct(s, 'almanac:x')).toBe(false);
  });

  it('a list entered again from the card starts at its top; back from an item keeps it', () => {
    const s = make();
    depthAct(s, 'depth:github:ci');
    s.depth.scroll['github:ci'] = { y: 40, v: 0, target: 40, max: 80, wheelAt: -1, t: s.t };
    depthAct(s, 'depth:github:run:1');
    depthBack(s);
    expect(s.depth.scroll['github:ci']?.y).toBe(40);
    depthBack(s);
    expect(s.depth.scroll['github:ci']?.y).toBe(40);
    depthAct(s, 'depth:github:ci');
    expect(s.depth.scroll['github:ci']).toBeUndefined();
  });

  it('settles a level change in about a quarter second, without a big overshoot', () => {
    expect(springStep(0)).toBe(0);
    expect(springStep(0.25)).toBeGreaterThan(0.9);
    let peak = 0;
    for (let t = 0; t < 1; t += 1 / 120) peak = Math.max(peak, springStep(t));
    expect(peak).toBeLessThan(1.01);
    expect(springStep(2)).toBe(1);
  });
});

describe('the wheel', () => {
  function withList(s: ReturnType<typeof make>, max: number) {
    s.hits.push({ x: 0, y: 0, w: 100, h: 60, act: 'scroll:l' });
    s.depth.scroll.l = { y: 0, v: 0, target: 0, max, wheelAt: -1, t: s.t };
  }

  it('scrolls the list under the pointer, a notch about a row and a half', () => {
    const s = make();
    withList(s, 100);
    expect(islandWheel(s, { x: 10, y: 10 }, 0, 100)).toBe(true);
    expect(s.depth.scroll.l?.target).toBe(32);
    expect(islandWheel(s, { x: 500, y: 10 }, 0, 100)).toBe(false);
  });

  it('meets resistance past an end, and only for the part past it', () => {
    const s = make();
    withList(s, 40);
    islandWheel(s, { x: 10, y: 10 }, 0, 100); // 32
    islandWheel(s, { x: 10, y: 10 }, 0, 100); // 40 free + 24 * 0.3
    expect(s.depth.scroll.l?.target).toBeCloseTo(40 + 24 * 0.3);
    for (let i = 0; i < 20; i++) islandWheel(s, { x: 10, y: 10 }, 0, 100);
    expect(s.depth.scroll.l?.target).toBe(40 + 22);
    islandWheel(s, { x: 10, y: 10 }, 0, -100);
    expect(s.depth.scroll.l?.target).toBeLessThan(40 + 22);
  });

  it('a swipe to the right goes back', () => {
    const s = make();
    depthAct(s, 'depth:almanac:item:a');
    islandWheel(s, { x: 10, y: 10 }, -40, 2);
    expect(depthTop(s, 'almanac')).toBe('item:a');
    islandWheel(s, { x: 10, y: 10 }, -40, 2);
    expect(depthTop(s, 'almanac')).toBe('');
  });
});

describe('an action that asks twice', () => {
  it('a PR is approved only on a second click within 3 s', async () => {
    const { islandPointerDown } = await import('./input');
    const s = make();
    const zone = { x: 0, y: 0, w: 50, h: 20, act: 'ghok:https://github.com/me/app/pull/7' };
    const click = () => {
      s.hits = [zone];
      islandPointerDown(s, { x: 5, y: 5 });
    };
    click();
    expect(s.requests).toEqual([]);
    s.t += 4;
    click();
    expect(s.requests).toEqual([]);
    s.t += 1;
    click();
    expect(s.requests).toEqual(['gh:approve:https://github.com/me/app/pull/7']);
  });
});
