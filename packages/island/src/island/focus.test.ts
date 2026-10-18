import { describe, expect, it } from 'vitest';
import { createState } from '../sim/state';
import { defaultSettings } from '../sim/settings';
import { mulberry32, PARITY_SEED } from '../sim/rng';
import { autoFocus, effectiveFocus, notchState } from './focus';
import { modules } from './modules';
import { miniCrew } from './crew';

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

describe('switched-off modules (the app, stage 7)', () => {
  it('none off: the prototype order', () => {
    const s = make();
    s.event = ev('success');
    expect(autoFocus(s)).toBe('github');
    expect(modules(s).map((m) => m.id)).toEqual(['claude', 'github', 'cal', 'music', 'almanac']);
  });
  it('skips an off module and falls back to the first one left', () => {
    const s = make();
    s.event = ev('success');
    s.off = ['github'];
    expect(autoFocus(s)).not.toBe('github');
    s.event = null;
    s.off = ['almanac', 'claude'];
    s.musicPlaying = false;
    // the stub call is 1-14 min away, so the calendar wins anyway; with it off too - music
    expect(autoFocus(s)).toBe('cal');
    s.off = ['almanac', 'claude', 'cal'];
    expect(autoFocus(s)).toBe('music');
    expect(modules(s).map((m) => m.id)).toEqual(['github', 'music']);
    expect(miniCrew(s)).toHaveLength(2);
  });
  it('a picked card of an off module gives way', () => {
    const s = make();
    s.focusId = 'music';
    s.off = ['music'];
    expect(effectiveFocus(s)).not.toBe('music');
  });
});

describe('Notion (the app, stage 8)', () => {
  const feed = {
    auth: 'ok' as const,
    rows: [{ id: 'p1', title: 'План', emoji: null, ago: '5 мин' }],
    short: 'План',
    hint: ['', ''] as [string, string],
  };
  it('no feed: no module, the prototype is untouched', () => {
    const s = make();
    s.focusId = 'notion';
    expect(modules(s).map((m) => m.id)).not.toContain('notion');
    expect(miniCrew(s)).toHaveLength(4);
    expect(effectiveFocus(s)).not.toBe('notion');
  });
  it('with a feed: a module of its own, its edit events, can be switched off', () => {
    const s = make();
    s.notion = feed;
    expect(modules(s).map((m) => m.id)).toEqual(['claude', 'github', 'cal', 'music', 'almanac', 'notion']);
    expect(miniCrew(s)).toHaveLength(4);
    s.off = ['music', 'github', 'cal'];
    expect(miniCrew(s).map((m) => m.id)).toEqual(['claude', 'notion']);
    s.off = [];
    s.event = { ...ev('success'), src: 'notion' };
    expect(autoFocus(s)).toBe('notion');
    s.off = ['notion'];
    expect(autoFocus(s)).toBe('github');
    expect(modules(s).map((m) => m.id)).not.toContain('notion');
  });
});

describe('Vercel (the app, stage 8)', () => {
  const feed = (state: 'run' | 'fail' | 'ok' | 'none') => ({
    auth: 'ok' as const,
    state,
    rows: [{ id: 'd1', name: 'site', state: 'ok' as const, ago: '2 ч' }],
    short: 'деплой готов',
    hint: ['', ''] as [string, string],
  });
  it('no feed: no module, the prototype is untouched', () => {
    const s = make();
    s.focusId = 'vercel';
    expect(modules(s).map((m) => m.id)).not.toContain('vercel');
    expect(miniCrew(s)).toHaveLength(4);
    expect(effectiveFocus(s)).not.toBe('vercel');
  });
  it('with a feed: the sixth module, its own events, can be switched off', () => {
    const s = make();
    s.vercel = feed('fail');
    expect(modules(s).map((m) => m.id)).toEqual(['claude', 'github', 'cal', 'music', 'almanac', 'vercel']);
    expect(modules(s)[5]?.state).toBe('fail');
    // the ear's 2 × 2 crew takes the first four switched on
    expect(miniCrew(s).map((m) => m.state)).not.toContain('fail');
    s.off = ['music'];
    expect(miniCrew(s).map((m) => m.state)).toContain('fail');
    s.off = [];
    s.event = { ...ev('success'), src: 'vercel' };
    expect(autoFocus(s)).toBe('vercel');
    s.off = ['vercel'];
    expect(autoFocus(s)).toBe('github');
    expect(modules(s).map((m) => m.id)).not.toContain('vercel');
  });
});

describe('Grafana (the app, stage 8)', () => {
  const feed = {
    auth: 'ok' as const,
    state: 'fail' as const,
    rows: [{ id: 'r', name: 'CPU', state: 'fail' as const, ago: '1 мин' }],
    total: 1,
    board: null,
    short: 'горит 1',
    hint: ['', ''] as [string, string],
  };
  it('no feed: no module, the prototype is untouched', () => {
    const s = make();
    s.focusId = 'grafana';
    expect(modules(s).map((m) => m.id)).not.toContain('grafana');
    expect(miniCrew(s)).toHaveLength(4);
    expect(effectiveFocus(s)).not.toBe('grafana');
  });
  it('with a feed: a module of its own, firing in its mini, its events, can be switched off', () => {
    const s = make();
    s.grafana = feed;
    expect(modules(s).map((m) => m.id)).toEqual(['claude', 'github', 'cal', 'music', 'almanac', 'grafana']);
    expect(modules(s).find((m) => m.id === 'grafana')?.state).toBe('fail');
    s.off = ['music', 'github', 'cal'];
    expect(miniCrew(s).map((m) => [m.id, m.state])).toEqual([
      ['claude', 'idle'],
      ['grafana', 'fail'],
    ]);
    s.off = [];
    s.event = { ...ev('success'), type: 'error', src: 'grafana' };
    expect(autoFocus(s)).toBe('grafana');
    s.off = ['grafana'];
    expect(autoFocus(s)).toBe('github');
  });
});
