import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { mulberry32, PARITY_SEED } from './rng';

// The reference frames were shot with the Math.random that tools/snapshot.mjs injects.
// Run that exact snippet and check the port draws the same numbers.
function snapshotRandom(): () => number {
  const src = readFileSync(new URL('../../../../tools/snapshot.mjs', import.meta.url), 'utf8');
  const m = /const SEED = `([\s\S]*?)`;/.exec(src);
  if (!m?.[1]) throw new Error('SEED snippet not found in tools/snapshot.mjs');
  const ctx: { Math: Math } = { Math: Object.create(Math) as Math };
  runInNewContext(m[1], ctx);
  return ctx.Math.random;
}

describe('mulberry32', () => {
  it('matches the generator used to shoot reference/screens', () => {
    const ref = snapshotRandom();
    const rng = mulberry32(PARITY_SEED);
    for (let i = 0; i < 1000; i++) expect(rng()).toBe(ref());
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 10000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
