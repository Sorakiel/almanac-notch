import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMascot } from '../index';
import { defaultSettings } from './settings';
import { mulberry32, PARITY_SEED } from './rng';
import type { IslandState } from './state';
import { notchState } from '../island/focus';

const DT = 1 / 60;

// a mascot with its own virtual clock; `now` is the real-time clock the prototype reads for idleness
function make(seed = PARITY_SEED) {
  const m = createMascot({ settings: defaultSettings(), rng: mulberry32(seed), now: 0 });
  m.state.W = 758;
  m.state.H = 420;
  let now = 0;
  const run = (secs: number) => {
    for (let i = 0; i < Math.round(secs / DT); i++) {
      now += DT * 1000;
      m.update(DT, now);
    }
  };
  // a pointer that keeps moving resets the sleep timer, as the harness does on pointermove
  const touch = () => {
    m.state.ptr.lastMoveReal = now;
  };
  return { m, s: m.state, run, touch };
}

function snapshot(s: IslandState): string {
  // functions and settings are not state; timers are compared by due time
  return JSON.stringify(s, (k, v: unknown) =>
    k === 'S' || k === 'rng' || typeof v === 'function' ? undefined : k === 'timers' ? s.timers.map((t) => t.at) : v,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('determinism', () => {
  const script = (seed?: number) => {
    const { m, s, run } = make(seed);
    run(6.5);
    m.trigger('dance');
    run(2);
    m.poke(3);
    run(1.5);
    m.trigger('working');
    run(3);
    m.trigger('success');
    run(3);
    m.poke(6);
    run(5);
    return snapshot(s);
  };

  it('same seed gives the same state', () => {
    expect(script()).toBe(script());
  });

  it('a different seed gives a different state', () => {
    expect(script(1)).not.toBe(script());
  });

  it('never touches Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used');
    });
    expect(() => script()).not.toThrow();
  });
});

describe('behaviour timings', () => {
  it('greets 0.5 s after launch and the greeting lasts 4.6 s', () => {
    const { s, run } = make();
    run(0.45);
    expect(s.event).toBeNull();
    run(0.1);
    expect(s.event?.type).toBe('greeting');
    run(4.6);
    expect(s.event).toBeNull();
    expect(s.postLaunchUntil).toBeCloseTo(s.t + 30, 1);
  });

  it('blinks every 3.6 × (0.55…1.45) s', () => {
    const { s, run, touch } = make();
    run(6);
    const blinks: number[] = [];
    let was = false;
    for (let i = 0; i < 20 * 60; i++) {
      touch();
      run(DT);
      const on = s.blinkUntil > s.t;
      if (on && !was) blinks.push(s.t);
      was = on;
    }
    expect(blinks.length).toBeGreaterThan(4);
    expect(blinks.length).toBeLessThan(20);
  });

  it('three pokes sulk for 2.6 s, six overload for 3.2 s', () => {
    const { m, s, run } = make();
    run(6.5);
    m.poke(3);
    run(0.3);
    expect(s.layerText.ia).toBe('дуется');
    run(2.4);
    expect(s.layerText.ia).not.toBe('дуется');

    m.poke(6);
    run(0.5);
    expect(s.layerText.ia).toBe('перегруз');
    expect(s.glowColor).toBe('#FF5FA2');
    run(1);
    expect(s.sp.spin.x).toBeGreaterThan(0.5);
    run(1.8);
    expect(s.rebootAt).toBeCloseTo(s.overloadUntil, 1);
    run(3);
    expect(s.sp.spin.x).toBeLessThan(0.05);
  });

  it('falls asleep after 30 s without pointer movement, wakes with a startle', () => {
    const { m, s, run } = make();
    run(29);
    expect(s.sleeping).toBe(false);
    run(1.5);
    expect(s.sleeping).toBe(true);
    run(2);
    expect(s.particles.some((p) => p.type === 'z')).toBe(true);
    m.poke(1);
    expect(s.sleeping).toBe(false);
    expect(s.sp.wide.v).toBeGreaterThan(5);
  });

  it('infinite events toggle off, timed events expire', () => {
    const { m, s, run } = make();
    run(6.5);
    m.trigger('thinking');
    expect(s.event?.type).toBe('thinking');
    m.trigger('thinking');
    expect(s.event).toBeNull();
    m.trigger('error');
    run(2.9);
    expect(s.event?.type).toBe('error');
    run(0.2);
    expect(s.event).toBeNull();
  });

  it('approving an attention starts work after 0.55 s', () => {
    const { m, s, run } = make();
    run(6.5);
    m.trigger('attention');
    run(0.5);
    m.answer('approve');
    run(0.5);
    expect(s.event?.type).toBe('attention');
    run(0.1);
    expect(s.event?.type).toBe('working');
    expect(s.happyUntil).toBeGreaterThan(s.t);
  });
});

describe('half-open hold after open (CHANGES 2026-10-14)', () => {
  it('stays half-open for 30 s after the hover leaves, then closes', () => {
    const { s, run, touch } = make();
    run(80); // launch greeting and its 30 s hold are over
    touch();
    expect(notchState(s)).toBe('closed');
    s.islandHover = true;
    run(1);
    expect(notchState(s)).toBe('open');
    s.islandHover = false;
    run(1);
    expect(notchState(s)).toBe('half');
    touch();
    run(28.5);
    expect(notchState(s)).toBe('half');
    run(1);
    expect(notchState(s)).toBe('closed');
  });

  it('does not hold when the state is forced', () => {
    const { s, run } = make();
    run(80);
    s.S.nstate = 'open';
    run(1);
    s.S.nstate = 'auto';
    run(0.1);
    expect(notchState(s)).toBe('closed');
  });
});
