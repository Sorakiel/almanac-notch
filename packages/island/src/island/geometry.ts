// Island outline and the ear / height targets of renderIsland (docs/SPEC.md 2.2).
import type { Ctx } from '../util/draw';
import type { NotchState } from './focus';

/** menu bar height */
export const MB = 32;
/** proto: NOTCH_W */
export const NOTCH_W = 190;

/** proto: islandShape - the strip with concave "shoulders" (f = 6) where it meets the top edge */
export function islandShape(c: Ctx, x0: number, x1: number, h: number, r: number): void {
  const f = 6;
  c.beginPath();
  c.moveTo(x0 - f, 0);
  c.lineTo(x1 + f, 0);
  c.quadraticCurveTo(x1, 0, x1, f);
  c.lineTo(x1, h - r);
  c.arcTo(x1, h, x1 - r, h, r);
  c.lineTo(x0 + r, h);
  c.arcTo(x0, h, x0, h - r, r);
  c.lineTo(x0, f);
  c.quadraticCurveTo(x0, 0, x0 - f, 0);
  c.closePath();
}

export interface IslandInputs {
  IW: number;
  state: NotchState;
  win: boolean;
  /** an event of type ratelimit is running */
  ratelimit: boolean;
  /** there is a status (proto: st) */
  status: boolean;
  /** the status drops an approval / question block (proto: st.drop) */
  drop: boolean;
  /** width of the status text at 500 12px Onest */
  textW: number;
  /** extra width of the wave dots effect (26 or 0) */
  dotsW: number;
}

export interface IslandTargets {
  eL: number;
  eR: number;
  hh: number;
  baseW: number;
}

/** proto: renderIsland - targets of the earL / earR / ih / nw springs */
export function islandTargets(i: IslandInputs): IslandTargets {
  const { IW, state, win } = i;
  const NW = Math.min(NOTCH_W, IW * 0.36);
  const OPEN_W = Math.min(IW - 24, 480),
    OPEN_H = 150;
  let eL = 0,
    eR = 0,
    hh = MB,
    baseW = NW;
  if (state === 'half') {
    eL = i.ratelimit ? 52 : 44;
    eR = i.status && !i.drop ? Math.min(IW / 2 - NW / 2 - 10, 18 + i.textW + i.dotsW) : i.status && i.drop ? 44 : 50;
    hh = i.status && i.drop ? MB + 54 : MB;
    // the strip stays centred on the screen: both ears take the width of the wider one
    eL = eR = Math.min(IW / 2 - NW / 2 - 10, Math.max(eL, eR));
  } else if (state === 'open') {
    eL = eR = (OPEN_W - NW) / 2;
    hh = OPEN_H;
  } else if (win) {
    baseW = 96;
    hh = 9;
  }
  return { eL, eR, hh, baseW };
}
