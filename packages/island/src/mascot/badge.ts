import { clamp } from '../util/math';
import type { Ctx } from '../util/draw';
import { toWorld, type Pose } from '../sim/pose';
import type { IslandState } from '../sim/state';

/** proto: drawBadge - the status dot, bottom right on the body, with a ring in the background colour */
export function drawBadge(s: IslandState, c: Ctx, P: Pose, ring: string): void {
  const a = clamp(s.sp.badge.x, 0, 1.4);
  if (a < 0.02) return;
  const [bx, by] = toWorld(P, P.R * 0.7, P.b * 0.6);
  const r = (P.mini === 'notch' ? 3.3 : P.R * 0.13) * Math.min(a, 1.25),
    rr = r + (P.mini === 'notch' ? 1.6 : P.R * 0.05);
  c.save();
  c.globalAlpha *= Math.min(1, a);
  c.fillStyle = ring;
  c.beginPath();
  c.arc(bx, by, rr, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = s.badgeColor;
  c.beginPath();
  c.arc(bx, by, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
