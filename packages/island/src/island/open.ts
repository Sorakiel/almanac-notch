// Open state: top bar, tabs and cards. Stage 2c ports proto: drawOpen; until then it draws nothing.
import type { Ctx } from '../util/draw';
import type { IslandState } from '../sim/state';
import type { Status } from '../sim/events';
import type { WorkFx } from './fx';

type DrawOpen = (
  s: IslandState,
  c: Ctx,
  x0: number,
  x1: number,
  top: number,
  bottom: number,
  st: Status | null,
  fx: WorkFx | null,
  barY: number,
) => void;

/** proto: drawOpen (stub until stage 2c) */
export const drawOpen: DrawOpen = () => undefined;
