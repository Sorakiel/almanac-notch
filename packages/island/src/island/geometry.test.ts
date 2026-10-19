import { describe, expect, it } from 'vitest';
import { MB, NOTCH_W, islandShape, islandTargets, type IslandInputs } from './geometry';
import type { Ctx } from '../util/draw';

const IW = 758;
const NW = Math.min(NOTCH_W, IW * 0.36);
const MAX_EAR = IW / 2 - NW / 2 - 10;
const base: IslandInputs = {
  IW,
  state: 'half',
  win: false,
  ratelimit: false,
  status: false,
  drop: false,
  textW: 0,
  dotsW: 0,
};

describe('islandTargets (SPEC 2.2)', () => {
  it('half without status: crew ear 50, both ears equal', () => {
    expect(islandTargets(base)).toEqual({ eL: 50, eR: 50, hh: MB, baseW: NW });
  });

  it('half with status: right ear 18 + text (+26 for dots), left ear follows', () => {
    expect(islandTargets({ ...base, status: true, textW: 60 })).toMatchObject({ eL: 78, eR: 78 });
    expect(islandTargets({ ...base, status: true, textW: 60, dotsW: 26 })).toMatchObject({ eL: 104, eR: 104 });
  });

  it('the left ear wins when it is wider: 44, 52 at rate limit', () => {
    expect(islandTargets({ ...base, status: true, textW: 10 })).toMatchObject({ eL: 44, eR: 44 });
    expect(islandTargets({ ...base, status: true, textW: 10, ratelimit: true })).toMatchObject({ eL: 52, eR: 52 });
  });

  it('long text is capped at IW/2 - NW/2 - 10 and the strip stays centred', () => {
    const t = islandTargets({ ...base, status: true, textW: 1000 });
    expect(t.eR).toBeCloseTo(MAX_EAR);
    expect(t.eL).toBe(t.eR);
  });

  it('a narrow screen caps even the left ear', () => {
    const t = islandTargets({ ...base, IW: 240, ratelimit: true });
    const cap = 240 / 2 - Math.min(NOTCH_W, 240 * 0.36) / 2 - 10;
    expect(t.eL).toBeCloseTo(Math.min(cap, 52));
    expect(t.eL).toBe(t.eR);
  });

  it('half with a drop block: ear 44, height MB + 54', () => {
    expect(islandTargets({ ...base, status: true, drop: true, textW: 300 })).toEqual({
      eL: 44,
      eR: 44,
      hh: MB + 54,
      baseW: NW,
    });
  });

  // 2026-10-19 (docs/CHANGES.md): 600 x 180 instead of the prototype's 480 x 150
  it('open: min(IW - 24, 600) wide, 180 high, symmetric', () => {
    const t = islandTargets({ ...base, IW: 680, state: 'open' });
    expect(t.eL).toBe(t.eR);
    expect(NW + t.eL + t.eR).toBeCloseTo(600);
    expect(t.hh).toBe(180);
    const m = islandTargets({ ...base, state: 'open' });
    expect(NW + m.eL + m.eR).toBeCloseTo(Math.min(IW - 24, 600));
    const n = islandTargets({ ...base, IW: 400, state: 'open' });
    expect(Math.min(NOTCH_W, 400 * 0.36) + n.eL + n.eR).toBeCloseTo(376);
  });

  it('closed: Mac keeps the notch, Windows folds into a 96 × 9 tile', () => {
    expect(islandTargets({ ...base, state: 'closed' })).toEqual({ eL: 0, eR: 0, hh: MB, baseW: NW });
    expect(islandTargets({ ...base, state: 'closed', win: true })).toEqual({ eL: 0, eR: 0, hh: 9, baseW: 96 });
  });

  it('Windows uses the same strip as the Mac when not closed', () => {
    for (const state of ['half', 'open'] as const)
      expect(islandTargets({ ...base, state, win: true })).toEqual(islandTargets({ ...base, state }));
  });

  it('notch width is min(190, 0.36·IW)', () => {
    expect(islandTargets({ ...base, IW: 400 }).baseW).toBeCloseTo(144);
    expect(islandTargets({ ...base, IW: 1000 }).baseW).toBe(190);
  });
});

describe('islandShape', () => {
  it('traces the shoulders and the rounded bottom', () => {
    const calls: [string, ...number[]][] = [];
    const rec =
      (name: string) =>
      (...a: number[]) =>
        calls.push([name, ...a]);
    const c = {
      beginPath: rec('beginPath'),
      moveTo: rec('moveTo'),
      lineTo: rec('lineTo'),
      quadraticCurveTo: rec('quad'),
      arcTo: rec('arcTo'),
      closePath: rec('closePath'),
    } as unknown as Ctx;
    islandShape(c, 100, 300, 32, 10);
    expect(calls).toEqual([
      ['beginPath'],
      ['moveTo', 94, 0],
      ['lineTo', 306, 0],
      ['quad', 300, 0, 300, 6],
      ['lineTo', 300, 22],
      ['arcTo', 300, 32, 290, 32, 10],
      ['lineTo', 110, 32],
      ['arcTo', 100, 32, 100, 22, 10],
      ['lineTo', 100, 6],
      ['quad', 100, 0, 94, 0],
      ['closePath'],
    ]);
  });
});
