import { clamp, hexA, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { Pose } from '../sim/pose';
import type { IslandState } from '../sim/state';
import { drawOrbit, type WorkFx } from '../island/fx';

/** proto: drawThinkArc - a comet arc slowly circling the mascot, so it never looks like the busy orbit */
export function drawThinkArc(s: IslandState, c: Ctx, x: number, y: number, r: number, a: number, lw: number): void {
  if (a < 0.03) return;
  const start = s.t * 2.1;
  const segs = 14;
  c.save();
  c.lineCap = 'round';
  c.lineWidth = lw;
  for (let i = 0; i < segs; i++) {
    const k = i / segs;
    c.strokeStyle = hexA('#A07CFF', a * (0.08 + 0.92 * k));
    c.beginPath();
    c.arc(x, y, r, start + k * 1.9, start + (k + 1 / segs) * 1.9 + 0.02);
    c.stroke();
  }
  c.restore();
}

/** proto: drawRings - success: two rings spreading out from the mascot */
export function drawRings(
  c: Ctx,
  x: number,
  y: number,
  el: number,
  r0: number,
  r1: number,
  lw: number,
  color: string,
): void {
  for (let i = 0; i < 2; i++) {
    const k = (el - i * 0.22) / 0.75;
    if (k <= 0 || k >= 1) continue;
    c.strokeStyle = hexA(color, (1 - k) * 0.9);
    c.lineWidth = lw * (1 - k * 0.5);
    c.beginPath();
    c.arc(x, y, r0 + (r1 - r0) * (1 - Math.pow(1 - k, 3)), 0, Math.PI * 2);
    c.stroke();
  }
}

/** proto: drawHourglass - rate limit: a filled hourglass with amber sand that flips over every few seconds */
export function drawHourglass(c: Ctx, x: number, y: number, s: number, el: number): void {
  const ph = el % 4,
    flow = clamp(ph / 3.3, 0, 1),
    flip = ph > 3.3 ? ss(0, 1, (ph - 3.3) / 0.7) : 0;
  const w = s * 0.8,
    h = s,
    fr = Math.max(1.3, s * 0.2);
  c.save();
  c.translate(x, y);
  c.rotate(flip * Math.PI);
  const glass = () => {
    c.beginPath();
    c.moveTo(-w, -h);
    c.lineTo(w, -h);
    c.bezierCurveTo(w, -h * 0.3, w * 0.2, -h * 0.18, w * 0.16, 0);
    c.bezierCurveTo(w * 0.2, h * 0.18, w, h * 0.3, w, h);
    c.lineTo(-w, h);
    c.bezierCurveTo(-w, h * 0.3, -w * 0.2, h * 0.18, -w * 0.16, 0);
    c.bezierCurveTo(-w * 0.2, -h * 0.18, -w, -h * 0.3, -w, -h);
    c.closePath();
  };
  glass();
  c.fillStyle = 'rgba(255,255,255,0.16)';
  c.fill();
  c.save();
  glass();
  c.clip();
  c.fillStyle = '#F5A524';
  const topH = 0.85 * h * (1 - flow);
  if (topH > 0.3) c.fillRect(-w, -topH, 2 * w, topH);
  const pile = 0.85 * h * flow,
    py = h - pile;
  if (pile > 0.3) {
    c.beginPath();
    c.moveTo(-w, h);
    c.lineTo(-w, py + h * 0.14);
    c.quadraticCurveTo(0, py - h * 0.12, w, py + h * 0.14);
    c.lineTo(w, h);
    c.closePath();
    c.fill();
  }
  if (flow < 1 && flip === 0) c.fillRect(-Math.max(0.5, s * 0.06), 0, Math.max(1, s * 0.12), h - pile * 0.8);
  c.restore();
  glass();
  c.strokeStyle = 'rgba(255,255,255,0.6)';
  c.lineWidth = Math.max(0.8, s * 0.09);
  c.stroke();
  c.fillStyle = '#D5D8DE';
  rrect(c, -w - fr * 0.6, -h - fr, 2 * w + fr * 1.2, fr, fr / 2);
  c.fill();
  rrect(c, -w - fr * 0.6, h, 2 * w + fr * 1.2, fr, fr / 2);
  c.fill();
  c.restore();
}

/** proto: stateMarks - search beam, question bubble, rate-limit hourglass */
export function stateMarks(s: IslandState, c: Ctx, mx: number, my: number, R: number, big: boolean): void {
  const event = s.event;
  if (!event) return;
  const el = s.t - event.start,
    k = ss(0, 1, el / 0.3);
  c.save();
  c.globalAlpha *= k;
  if (event.type === 'searching') {
    const x = mx + Math.sin(el * 3.2) * R * 1.15,
      y0 = my - R * 1.15,
      y1 = my + R * 0.95;
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, hexA('#38BDF8', 0));
    g.addColorStop(0.5, hexA('#38BDF8', 0.9));
    g.addColorStop(1, hexA('#38BDF8', 0));
    c.strokeStyle = g;
    c.lineWidth = big ? 2.4 : 1.6;
    c.shadowColor = '#38BDF8';
    c.shadowBlur = (big ? 10 : 5) * (c.getTransform().a / 2);
    c.beginPath();
    c.moveTo(x, y0);
    c.lineTo(x, y1);
    c.stroke();
  } else if (event.type === 'question') {
    const r = big ? R * 0.3 : 4.6,
      bx = mx + R * 0.88,
      by = my - R * 1.02 + Math.sin(el * 3) * (big ? 2 : 0.8);
    c.fillStyle = '#22C3E6';
    c.beginPath();
    c.arc(bx, by, r, 0, Math.PI * 2);
    c.fill();
    textAt(c, '?', bx, by + 0.5, { size: Math.round(r * 1.5), weight: 700, align: 'center', color: '#FFFFFF' });
  } else if (event.type === 'ratelimit') {
    drawHourglass(c, mx + R * (big ? 1.42 : 1.55), my, big ? R * 0.34 : 4.6, el);
  }
  c.restore();
}

/** proto: drawOverhead - marks above the big stage mascot */
export function drawOverhead(s: IslandState, c: Ctx, P: Pose): void {
  const wk = clamp(s.sp.work.x, 0, 1),
    th = clamp(s.sp.think.x, 0, 1);
  const top = P.ay - 2 * P.b * P.sy;
  if (wk > 0.02) {
    for (let i = 0; i < 3; i++) {
      const a = s.t * 2.4 + (i * Math.PI * 2) / 3,
        depth = (Math.sin(a) + 1) / 2;
      const x = P.ax + Math.cos(a) * P.R * 0.62,
        y = top - P.R * 0.42 + Math.sin(a) * P.R * 0.15;
      c.globalAlpha = wk * (0.35 + 0.65 * depth);
      c.fillStyle = '#3D8BFF';
      c.beginPath();
      c.arc(x, y, P.R * (0.035 + 0.025 * depth), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }
  drawThinkArc(s, c, P.ax, P.ay - P.b * P.sy, P.R * 1.35, th, P.R * 0.05);
  stateMarks(s, c, P.ax, P.ay - P.b * P.sy, P.R, true);
  if (s.event && s.event.type === 'success')
    drawRings(c, P.ax, P.ay - P.b * P.sy, s.t - s.event.start, P.R * 1.0, P.R * 2.2, P.R * 0.05, '#34C759');
}

/** proto: mascotMarks - marks around a mascot drawn at radius R, centre (mx, my); back pass then front pass */
export function mascotMarks(
  s: IslandState,
  c: Ctx,
  fx: WorkFx | null,
  mx: number,
  my: number,
  R: number,
  front: boolean,
): void {
  const big = R > 16;
  if (front) stateMarks(s, c, mx, my, R, big);
  if (fx && (big || s.S.workfx === 'orbit'))
    drawOrbit(s, c, fx, mx, my - (big ? R * 1.1 : 0), front, big ? R * 0.9 : 16, big ? R * 0.22 : 4.5, big ? 2.4 : 1.9);
  if (front) {
    drawThinkArc(s, c, mx, my, big ? R * 1.45 : 14, clamp(s.sp.think.x, 0, 1), big ? 2.4 : 2);
    if (s.event && s.event.type === 'success')
      drawRings(c, mx, my, s.t - s.event.start, big ? R : 9, big ? R * 2 : 22, big ? 2.2 : 1.8, '#34C759');
  }
}
