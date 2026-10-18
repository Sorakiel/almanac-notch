import { mix } from '../util/math';
import type { Ctx } from '../util/draw';
import { isLight, type MascotColor } from '../sim/settings';
import type { Pose } from '../sim/pose';
import type { IslandState } from '../sim/state';

/** proto: drawHand - a detached round hand: it pops out beside the body and waves in an arc */
export function drawHand(s: IslandState, c: Ctx, P: Pose, col: MascotColor, hd: number): void {
  const R = P.R,
    b = P.b,
    k = Math.min(hd, 1);
  const ang = -0.9 + Math.sin(s.t * 14) * 0.55 * k;
  const px = R * 0.9,
    py = b * 0.12,
    arm = R * 0.42 * k;
  const x = px + Math.cos(ang) * arm,
    y = py + Math.sin(ang) * arm,
    r = R * 0.17 * (0.4 + 0.6 * k);
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, mix(col.body, '#FFFFFF', 0.25));
  g.addColorStop(1, col.shade);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  if (!P.mini && isLight(s.S.color)) {
    c.lineWidth = 1 / P.sx;
    c.strokeStyle = 'rgba(0,0,0,0.08)';
    c.stroke();
  }
}
