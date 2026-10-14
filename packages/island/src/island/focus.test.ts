import { describe, expect, it } from 'vitest';
import { createState } from '../sim/state';
import { defaultSettings } from '../sim/settings';
import { mulberry32, PARITY_SEED } from '../sim/rng';
import { notchState } from './focus';

function make() {
  const s = createState(defaultSettings(), mulberry32(PARITY_SEED), 0);
  s.t = 100; // past the post-launch window by default
  return s;
}
const ev = (type: 'attention' | 'question' | 'greeting' | 'working' | 'success') => ({
  type,
  start: 99,
  until: 200,
  nextHop: 0,
});

describe('notchState (SPEC 2.1)', () => {
  it('manual modes win over everything', () => {
    const s = make();
    s.islandHover = true;
    for (const m of ['closed', 'half', 'open'] as const) {
      s.S.nstate = m;
      expect(notchState(s)).toBe(m);
    }
  });

  it('idle is closed', () => {
    expect(notchState(make())).toBe('closed');
  });

  it('1. hover opens, even over a half-open event', () => {
    const s = make();
    s.event = ev('working');
    s.islandHover = true;
    expect(notchState(s)).toBe('open');
  });

  it('2. attention, question and greeting open', () => {
    for (const type of ['attention', 'question', 'greeting'] as const) {
      const s = make();
      s.event = ev(type);
      expect(notchState(s)).toBe('open');
    }
  });

  it('3. overload or alertA > 0.15 opens', () => {
    const s = make();
    s.overloadUntil = s.t + 1;
    expect(notchState(s)).toBe('open');
    const s2 = make();
    s2.sp.alertA.x = 0.16;
    expect(notchState(s2)).toBe('open');
    s2.sp.alertA.x = 0.15;
    expect(notchState(s2)).toBe('closed');
  });

  it('4. any other event, drag, sulking, hiding, petting is half', () => {
    const cases: ((s: ReturnType<typeof make>) => void)[] = [
      (s) => (s.event = ev('success')),
      (s) =>
        (s.grab = {
          active: true,
          sx: 0,
          sy: 0,
          lx: 0,
          ly: 0,
          vx: 0,
          vy: 0,
          ox: 0,
          oy: 0,
          plx: 0,
          ply: 0,
          tx: 0,
          ty: 0,
        }),
      (s) => (s.grumpyUntil = s.t + 1),
      (s) => (s.hideUntil = s.t + 1),
      (s) => (s.petting = true),
    ];
    for (const set of cases) {
      const s = make();
      set(s);
      expect(notchState(s)).toBe('half');
    }
  });

  it('an inactive grab is not a drag', () => {
    const s = make();
    s.grab = { active: false, sx: 0, sy: 0, lx: 0, ly: 0, vx: 0, vy: 0, ox: 0, oy: 0, plx: 0, ply: 0, tx: 0, ty: 0 };
    expect(notchState(s)).toBe('closed');
  });

  it('5. half for the post-launch window, closed after it', () => {
    const s = make();
    s.postLaunchUntil = 35.6;
    s.t = 35.5;
    expect(notchState(s)).toBe('half');
    s.t = 35.6;
    expect(notchState(s)).toBe('closed');
  });

  it('rules apply in order: open beats half', () => {
    const s = make();
    s.postLaunchUntil = 1e9;
    s.petting = true;
    s.overloadUntil = s.t + 1;
    expect(notchState(s)).toBe('open');
  });
});
