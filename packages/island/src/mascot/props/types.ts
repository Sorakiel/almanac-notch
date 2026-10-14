import type { Ctx } from '../../util/draw';
import type { MascotColor } from '../../sim/settings';
import type { Pose } from '../../sim/pose';
import type { IslandState } from '../../sim/state';

/**
 * A module prop. draw() works in body space: body centre at the origin, y down, before squash.
 * look is where the mascot looks while holding it, mood is the layer text.
 */
export interface Prop {
  look: readonly [number, number] | null;
  mood: string;
  draw(c: Ctx, R: number, b: number, mc: MascotColor | null, P: Pose, s: IslandState): void;
}
