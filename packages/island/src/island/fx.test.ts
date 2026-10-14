import { describe, expect, it } from 'vitest';
import { createState } from '../sim/state';
import { defaultSettings } from '../sim/settings';
import { mulberry32, PARITY_SEED } from '../sim/rng';
import { shakeX } from './fx';

describe('shakeX (SPEC 2.2)', () => {
  it('sin(42t)·3.2·e^(−5t) for 0.7 s of an error, 0 otherwise', () => {
    const s = createState(defaultSettings(), mulberry32(PARITY_SEED), 0);
    expect(shakeX(s)).toBe(0);
    s.event = { type: 'error', start: 10, until: 13, nextHop: 0 };
    for (const el of [0.05, 0.2, 0.5]) {
      s.t = 10 + el;
      expect(shakeX(s)).toBeCloseTo(Math.sin(el * 42) * 3.2 * Math.exp(-el * 5), 12);
    }
    s.t = 10.71;
    expect(shakeX(s)).toBe(0);
    s.event = { type: 'success', start: 10, until: 13, nextHop: 0 };
    s.t = 10.1;
    expect(shakeX(s)).toBe(0);
  });
});
