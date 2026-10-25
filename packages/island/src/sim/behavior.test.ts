import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMascot } from '../index';
import { defaultSettings } from './settings';
import { mulberry32, PARITY_SEED } from './rng';
import type { IslandState } from './state';
import { notchState } from '../island/focus';
import { islandPointerDown, islandPointerLeave, islandPointerMove, islandPointerUp } from '../island/input';

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

describe('events and the open view', () => {
  const mk = () => createMascot({ settings: defaultSettings(false), now: 0, greetAfter: null });
  it('reset the tab and card like the prototype by default', () => {
    const m = mk();
    m.setTab('settings');
    m.setFocus('github');
    m.trigger('working');
    expect([m.state.tab, m.state.focusId]).toEqual(['home', null]);
  });
  it('keep them with keepView (live statuses in the app)', () => {
    const m = mk();
    m.setTab('settings');
    m.setFocus('github');
    m.trigger('working', { keepView: true });
    expect([m.state.tab, m.state.focusId, m.state.event?.type]).toEqual(['settings', 'github', 'working']);
  });
});

describe("the app's open on hover and auto-close (stage 8g)", () => {
  function host(openOnHover: boolean) {
    const m = make();
    m.run(80);
    m.touch();
    m.s.host = { openOnHover, autoClose: 10, status: [], version: '', volume: 0.6 };
    return m;
  }

  it('off: hovering only peeks, a click opens, leaving keeps it open for the delay', () => {
    const { s, run, touch } = host(false);
    s.islandHover = true;
    run(1);
    expect(notchState(s)).toBe('half');
    islandPointerDown(s, { x: 0, y: 0 });
    run(0.1);
    expect(notchState(s)).toBe('open');
    islandPointerLeave(s);
    touch();
    run(9.5);
    expect(notchState(s)).toBe('open');
    run(1);
    // the delay ran out: back to the half-open hold, and the next visit only peeks again
    expect(notchState(s)).toBe('half');
    expect(s.clickOpen).toBe(false);
    s.islandHover = true;
    run(0.1);
    expect(notchState(s)).toBe('half');
  });

  // 2026-10-19 (docs/CHANGES.md): not at once as in the prototype - 0.6 s later, as coucou's
  it('on: hovering opens and leaving folds 0.6 s later', () => {
    const { s, run } = host(true);
    s.islandHover = true;
    run(1);
    expect(notchState(s)).toBe('open');
    islandPointerLeave(s);
    run(0.3);
    expect(notchState(s)).toBe('open');
    run(0.4);
    expect(notchState(s)).toBe('half');
  });

  it('sound: the switch and the speaker are one state, both saved by the host', () => {
    const { s } = host(true);
    s.hits = [
      { x: 0, y: 0, w: 20, h: 20, act: 'host:sound' },
      { x: 30, y: 0, w: 20, h: 20, act: 'mute' },
    ];
    islandPointerDown(s, { x: 5, y: 5 });
    expect(s.muted).toBe(true);
    islandPointerDown(s, { x: 35, y: 5 });
    expect(s.muted).toBe(false);
    expect(s.requests).toEqual(['host:sound', 'host:sound']);
  });

  it('volume: a press sets it, a drag follows past the track, the release saves once', () => {
    const { s } = host(true);
    s.hits = [{ x: 100, y: 0, w: 100, h: 20, act: 'host:vol', bx0: 100, bx1: 200 }];
    islandPointerDown(s, { x: 125, y: 5 });
    expect(s.host?.volume).toBe(0.25);
    expect(s.requests).toEqual([]);
    islandPointerMove(s, { x: 260, y: 40 }, 0);
    expect(s.host?.volume).toBe(1);
    islandPointerMove(s, { x: 150, y: 40 }, 0);
    expect(s.host?.volume).toBe(0.5);
    islandPointerUp(s);
    islandPointerUp(s);
    expect(s.requests).toEqual(['host:vol']);
    islandPointerMove(s, { x: 100, y: 5 }, 0);
    expect(s.host?.volume).toBe(0.5);
  });

  it('the harness (no host): the speaker only mutes, as in the prototype', () => {
    const { s, run } = make();
    run(80);
    s.hits = [{ x: 0, y: 0, w: 20, h: 20, act: 'mute' }];
    islandPointerDown(s, { x: 5, y: 5 });
    expect(s.muted).toBe(true);
    expect(s.requests).toEqual([]);
  });

  it('the harness (no host) ignores clicks for opening', () => {
    const { s, run } = make();
    run(80);
    s.islandHover = true;
    islandPointerDown(s, { x: 0, y: 0 });
    expect(s.clickOpen).toBe(false);
  });
});
