import { clamp } from '../util/math';
import { rrect, type Ctx } from '../util/draw';
import type { Eyes } from '../sim/pose';
import type { IslandState } from '../sim/state';

/** proto: eyeGlow - rim colour and strength per state (docs/SPEC.md 1.9) */
export function eyeGlow(s: IslandState): { c: string; a: number } | null {
  const { t, event, sp } = s;
  const sk = clamp(sp.spin.x, 0, 1);
  if (sk > 0.03) return { c: '#FF5FA2', a: (0.6 + 0.3 * Math.sin(t * 10)) * sk };
  if (t - s.rebootAt < 0.5) return { c: '#7CC4FF', a: 1 - (t - s.rebootAt) / 0.5 };
  if (!event) return null;
  const el = t - event.start;
  switch (event.type) {
    case 'greeting':
      return el > 1.95 && el < 2.45 ? { c: '#7CC4FF', a: 1 - (el - 1.95) / 0.5 } : null;
    case 'working':
      return { c: '#3D8BFF', a: 0.4 + 0.25 * Math.sin(el * 4) };
    case 'thinking':
      return { c: '#A07CFF', a: 0.45 + 0.3 * Math.sin(el * 2) };
    case 'searching':
      return { c: '#38BDF8', a: 0.35 + 0.6 * Math.pow(Math.abs(Math.cos(el * 3.2)), 6) };
    case 'attention':
      return { c: '#F5A524', a: 0.55 + 0.4 * Math.sin(el * 5) };
    case 'question':
      return { c: '#22C3E6', a: 0.5 + 0.3 * Math.sin(el * 3) };
    case 'success':
      return { c: '#34C759', a: Math.max(0, 1 - el / 1.4) };
    case 'error':
      return { c: '#FF453A', a: Math.max(0, 1 - el / 1.6) * (0.6 + 0.4 * Math.sin(el * 18)) };
    case 'dance':
      return { c: '#FF5FA2', a: 0.5 + 0.45 * Math.sin(el * 12.6) };
    case 'ratelimit':
      return { c: '#A1A1A6', a: Math.sin(el * 1.3) > 0.97 ? 0.7 : 0.12 };
  }
  return null;
}

/** proto: drawSpinEyes - g grows 0 -> 1: a dot opens into a spinning arc */
export function drawSpinEyes(s: IslandState, c: Ctx, E: Eyes, color: string, rim: boolean, g: number): void {
  for (const e of E.list) {
    const rr = e.w * 0.78 * g,
      lw = (e.w * 0.42 + (rim ? e.w * 0.4 : 0)) * (0.6 + 0.4 * g),
      a0 = s.t * 9 * e.side;
    c.save();
    c.strokeStyle = c.fillStyle = color;
    c.lineWidth = lw;
    c.lineCap = 'round';
    if (g < 0.98) {
      c.beginPath();
      c.arc(e.ex, e.ey, (e.w / 2 + (rim ? e.w * 0.2 : 0)) * (1 - g), 0, Math.PI * 2);
      c.fill();
    }
    if (g > 0.02) {
      c.beginPath();
      c.arc(e.ex, e.ey, rr, a0, a0 + Math.PI * 1.35 * g + 0.01);
      c.stroke();
    }
    c.restore();
  }
}

/** proto: eyesOrSpin - the pill shrinks to a dot, then the ring grows out of it */
export function eyesOrSpin(s: IslandState, c: Ctx, E: Eyes, color: string, rim: boolean, k: number): void {
  if (k < 0.5) {
    const q = 1 - k * 2;
    const E2: Eyes = {
      ...E,
      list: E.list.map((e) => ({ ...e, h: e.w + (e.h - e.w) * q, eh: e.eh * (0.4 + 0.6 * q) })),
    };
    drawEyes(c, k > 0.02 ? E2 : E, color, rim);
  } else drawSpinEyes(s, c, E, color, rim, (k - 0.5) * 2);
}

/** proto: drawEyes - happy eyes are a morph, not a crossfade: the pill flattens to a line, then bends into an arc */
export function drawEyes(c: Ctx, E: Eyes, color: string, rim: boolean): void {
  for (const e0 of E.list) {
    const hp = E.happy,
      normK = clamp(1 - hp * 2, 0, 1),
      arcK = clamp(hp * 2 - 1, 0, 1);
    const e = { ...e0, h: hp > 0.01 ? Math.max(e0.h * normK, e0.w * 0.55) : e0.h };
    const d = rim ? e0.w * 0.2 : 0;
    if (hp < 0.5) {
      c.save();
      if (E.grump > 0.01) {
        // sulking: the top of the eye is cut by a slanted line, lower on the inner side
        const top = e.ey - e.h / 2 + E.grump * e.h * 0.42,
          slope = E.grump * e.h * 0.4;
        const xIn = e.ex - e.side * e.w,
          xOut = e.ex + e.side * e.w;
        c.beginPath();
        c.moveTo(xOut, top - slope * 0.5);
        c.lineTo(xIn, top + slope * 0.5);
        c.lineTo(xIn, e.ey + e.eh);
        c.lineTo(xOut, e.ey + e.eh);
        c.closePath();
        c.clip();
      }
      c.fillStyle = color;
      rrect(c, e.ex - e.w / 2 - d, e.ey - e.h / 2 - d, e.w + 2 * d, e.h + 2 * d, Math.min(e.w, e.h) / 2 + d);
      c.fill();
      c.restore();
    } else {
      c.save();
      c.strokeStyle = color;
      c.lineWidth = e.w * 0.58 + 2 * d;
      c.lineCap = 'round';
      const aw = e.w * (0.22 + 0.73 * arcK),
        yEnd = e.ey + e.eh * 0.1 * arcK,
        yCtl = e.ey - e.eh * 0.44 * arcK;
      c.beginPath();
      c.moveTo(e.ex - aw, yEnd);
      c.quadraticCurveTo(e.ex, yCtl, e.ex + aw, yEnd);
      c.stroke();
      c.restore();
    }
  }
}
