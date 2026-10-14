/** Random source injected into the simulation so frames are reproducible. */
export type Rng = () => number;

/** Seed used by tools/snapshot.mjs for every reference scene. */
export const PARITY_SEED = 0x2545f491;

/**
 * mulberry32, bit for bit the generator tools/snapshot.mjs installs as Math.random,
 * so the harness draws the same sequence as the prototype did.
 */
export function mulberry32(seed: number): Rng {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
