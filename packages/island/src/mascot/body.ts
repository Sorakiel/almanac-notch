import { clamp, hexA } from '../util/math';
import type { Ctx } from '../util/draw';
import { CHALK, COLORS, isLight, type MascotColor } from '../sim/settings';
import { eyesOf, pose, type Mini, type Pose } from '../sim/pose';
import type { IslandState } from '../sim/state';
import { bodyPath } from './shape';
import { drawHand } from './hand';
import { drawBadge } from './badge';
import { eyeGlow, eyesOrSpin } from './eyes';

/** proto: drawShadowGlow - ground shadow (stage only) and the state glow behind the body */
export function drawShadowGlow(s: IslandState, c: Ctx, P: Pose): void {
  if (!P.mini) {
    c.save();
    c.globalAlpha = s.theme.shadowA * (1 - P.air * 0.7) * (1 - P.hide * 0.7);
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(
      P.cx + P.px * P.R,
      P.gy + P.R * 0.02,
      P.R * 0.78 * P.sx * (1 - P.air * 0.35),
      P.R * 0.1,
      0,
      0,
      Math.PI * 2,
    );
    c.fill();
    c.restore();
  }
  const ga = clamp(s.sp.glow.x, 0, 1);
  if (ga > 0.01) {
    const gcy = P.ay - P.b * P.sy,
      gr = P.R * (P.mini ? 1.4 : 2.1);
    const g = c.createRadialGradient(P.ax, gcy, P.R * 0.2, P.ax, gcy, gr);
    g.addColorStop(0, hexA(s.glowColor, (P.mini ? 0.35 : 0.45) * ga));
    g.addColorStop(1, hexA(s.glowColor, 0));
    c.fillStyle = g;
    c.fillRect(P.ax - gr, gcy - gr, gr * 2, gr * 2);
  }
}

/** proto: hideClip - clip at the ground while hiding */
export function hideClip(c: Ctx, P: Pose): void {
  if (P.hide > 0.01) {
    c.beginPath();
    c.rect(P.cx - P.R * 8, P.gy - P.R * 12, P.R * 16, P.R * 12);
    c.clip();
  }
}

/** proto: drawSeed - body, shading, outline on light colours, hand, glowing rim, eyes, status dot */
export function drawSeed(s: IslandState, c: Ctx, P: Pose, col: MascotColor, ring: string): void {
  drawShadowGlow(s, c, P);
  c.save();
  hideClip(c, P);
  c.translate(P.ax, P.ay);
  c.rotate(P.lean);
  c.scale(P.sx, P.sy);
  c.translate(0, -P.b);
  const hd = clamp(s.sp.hand.x, 0, 1.2);
  bodyPath(c, P.R, P.b);
  c.fillStyle = col.body;
  c.fill();
  c.save();
  bodyPath(c, P.R, P.b);
  c.clip();
  const g = c.createLinearGradient(0, -P.b, 0, P.b);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.45, hexA(col.shade, 0));
  g.addColorStop(1, hexA(col.shade, 0.75));
  c.fillStyle = g;
  c.fillRect(-P.R * 1.3, -P.b * 1.3, P.R * 2.6, P.b * 2.6);
  c.restore();
  if (!P.mini && isLight(s.S.color)) {
    bodyPath(c, P.R, P.b);
    c.lineWidth = 1 / P.sx;
    c.strokeStyle = 'rgba(0,0,0,0.08)';
    c.stroke();
  }
  if (hd > 0.02) drawHand(s, c, P, col, hd);
  const E0 = eyesOf(s, P),
    gl = eyeGlow(s),
    spinK = clamp(s.sp.spin.x, 0, 1);
  if (gl && gl.a > 0.03) {
    // a glowing rim in the state's colour; the eyes themselves stay dark
    const a = clamp(gl.a, 0, 1);
    c.save();
    c.shadowColor = hexA(gl.c, a);
    c.shadowBlur = P.R * (P.mini ? 0.5 : 0.4);
    eyesOrSpin(s, c, E0, hexA(gl.c, a), true, spinK);
    c.restore();
  }
  eyesOrSpin(s, c, E0, col.eye, false, spinK);
  c.restore();
  drawBadge(s, c, P, ring);
}

/** proto: drawMascot */
export function drawMascot(
  s: IslandState,
  c: Ctx,
  cx: number,
  gy: number,
  R: number,
  mini: Mini,
  ring: string,
  colOverride?: MascotColor | null,
): Pose {
  const col = colOverride || COLORS[s.S.color] || CHALK;
  const P = pose(s, cx, gy, R, mini);
  drawSeed(s, c, P, col, ring);
  return P;
}
