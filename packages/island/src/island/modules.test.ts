import { describe, expect, it } from 'vitest';
import { createState } from '../sim/state';
import { defaultSettings } from '../sim/settings';
import { mulberry32, PARITY_SEED } from '../sim/rng';
import { focusTint, idleShort, isHot, modules, primaryItem } from './modules';
import { STARS } from './cards';

function make() {
  const s = createState(defaultSettings(), mulberry32(PARITY_SEED), 0);
  s.t = 100;
  return s;
}
const ev = (type: 'working' | 'error' | 'success' | 'ratelimit', start = 99) => ({
  type,
  start,
  until: 1e9,
  nextHop: 0,
});

describe('modules (SPEC 2.5)', () => {
  it('lists the five modules in order with idle texts', () => {
    const s = make();
    const m = modules(s);
    expect(m.map((i) => i.id)).toEqual(['claude', 'github', 'cal', 'music', 'almanac']);
    expect(m.map((i) => i.short)).toEqual([
      'свободен',
      'CI зелёный',
      'созвон через 12 мин',
      'Lo-fi Radio',
      'привычки 3 из 5',
    ]);
    expect(m.map(idleShort)).toEqual(['свободен', 'CI зелёный', '12 мин', 'играет', '3/5']);
  });

  it('working: agent shows the current step, CI runs, both are hot', () => {
    const s = make();
    s.event = ev('working', 100 - 1.7 * 1.5);
    const m = modules(s);
    expect(m[0]?.short).toBe('правит island.ts');
    expect(m[1]?.short).toBe('CI идёт');
    expect(m.map(isHot)).toEqual([true, true, false, false, false]);
  });

  it('ratelimit counts down from 1:24', () => {
    const s = make();
    s.event = ev('ratelimit', 90);
    expect(modules(s)[0]?.short).toBe('лимит 1:14');
  });

  it('primaryItem: busy agent, then a call within 30 min, then music, then habits', () => {
    const s = make();
    expect(primaryItem(s).id).toBe('cal');
    s.event = ev('working');
    expect(primaryItem(s).id).toBe('claude');
  });

  it('focusTint follows the prototype table', () => {
    const s = make();
    expect(focusTint(s, 'music')).toEqual({ c: '#9EE6B8', a: 0.16 });
    expect(focusTint(s, 'claude')).toBeNull();
    s.event = ev('error');
    expect(focusTint(s, 'github')).toEqual({ c: '#FF453A', a: 0.45 });
    s.event = ev('working');
    expect(focusTint(s, 'claude')).toEqual({ c: '#3D8BFF', a: 0.3 });
    expect(focusTint(s, 'github')).toEqual({ c: '#3D8BFF', a: 0.22 });
  });
});

describe('STARS', () => {
  it('are fixed: 110 stars from Math.sin, not the rng', () => {
    expect(STARS).toHaveLength(110);
    const r1 = Math.sin(7 * 12.9898) * 43758.5453;
    expect(STARS[7]?.a).toBe((r1 - Math.floor(r1)) * Math.PI * 2);
    expect(STARS[3]?.d).toBe((3 * 0.618) % 1);
  });
});
