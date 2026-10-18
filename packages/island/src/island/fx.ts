// Island effects: the "working" variants, outline flash, shake and boot trace (docs/SPEC.md 2.2, 2.3).
import { clamp, hexA } from '../util/math';
import type { Ctx } from '../util/draw';
import type { IslandState } from '../sim/state';
import { EVENTS } from '../sim/events';

export interface WorkFx {
  col: string;
  wk: number;
  speed: number;
}

/** proto: workFx */
export function workFx(s: IslandState): WorkFx | null {
  const wk = clamp(s.sp.work.x, 0, 1);
  if (wk < 0.03) return null;
  return { col: '#3D8BFF', wk, speed: 2.6 };
}

/** proto: drawOrbit - three dots circling the mascot; back half dimmer, drawn behind the body */
export function drawOrbit(
  s: IslandState,
  c: Ctx,
  fx: WorkFx,
  mcx: number,
  mcy: number,
  front: boolean,
  rx: number,
  ry: number,
  dot: number,
): void {
  c.save();
  const base = c.globalAlpha;
  for (let i = 0; i < 3; i++) {
    const a = s.t * fx.speed + (i * Math.PI * 2) / 3,
      sn = Math.sin(a);
    if (sn >= 0 !== front) continue;
    c.globalAlpha = base * fx.wk * (front ? 1 : 0.45);
    c.fillStyle = fx.col;
    c.beginPath();
    c.arc(mcx + Math.cos(a) * rx, mcy + sn * ry, front ? dot : dot * 0.8, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** proto: drawWaveDots */
export function drawWaveDots(s: IslandState, c: Ctx, fx: WorkFx, x: number, y: number): void {
  c.save();
  const base = c.globalAlpha;
  for (let i = 0; i < 3; i++) {
    const k = (Math.sin(s.t * fx.speed * 1.6 - i * 0.7) + 1) / 2;
    c.globalAlpha = base * fx.wk * (0.35 + 0.65 * k);
    c.fillStyle = fx.col;
    c.beginPath();
    c.arc(x + i * 6.5, y - k * 1.6, 2, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** proto: drawShine - a soft highlight sweeping along the strip */
export function drawShine(s: IslandState, c: Ctx, fx: WorkFx, x0: number, x1: number, h: number): void {
  const w = x1 - x0,
    p = ((s.t * 0.55) % 1.4) - 0.2,
    sx = x0 + p * w;
  const g = c.createLinearGradient(sx - 30, 0, sx + 30, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, hexA(fx.col, 0.45 * fx.wk));
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(x0, 0, w, h);
}

/** proto: islandFlash - glowing outline on success and error */
export function islandFlash(s: IslandState, c: Ctx, path: () => void): void {
  const event = s.event;
  if (!event || (event.type !== 'success' && event.type !== 'error')) return;
  const el = s.t - event.start;
  const a =
    event.type === 'error' ? Math.max(0, 1 - el / 1.4) * (0.6 + 0.4 * Math.sin(el * 18)) : Math.max(0, 1 - el / 1.1);
  if (a < 0.02) return;
  const col = EVENTS[event.type].color;
  c.save();
  path();
  c.shadowColor = hexA(col, a);
  c.shadowBlur = 10;
  c.strokeStyle = hexA(col, a);
  c.lineWidth = 1.6;
  c.stroke();
  c.restore();
}

/** proto: shakeX - error shake of the content, sin(42t)·3.2·e^(−5t) for 0.7 s */
export function shakeX(s: IslandState): number {
  const event = s.event;
  if (!event || event.type !== 'error') return 0;
  const el = s.t - event.start;
  return el < 0.7 ? Math.sin(el * 42) * 3.2 * Math.exp(-el * 5) : 0;
}

/** proto: bootTrace - a short bright segment runs once around the island outline */
export function bootTrace(s: IslandState, c: Ctx, path: () => void, per: number): void {
  const event = s.event;
  if (!event || event.type !== 'greeting') return;
  const el = s.t - event.start;
  if (el > 0.75) return;
  const k = el / 0.75,
    a = Math.sin(Math.PI * k);
  c.save();
  path();
  c.setLineDash([per * 0.18, per]);
  c.lineDashOffset = -k * per * 1.18;
  c.strokeStyle = 'rgba(124,196,255,' + (0.95 * a).toFixed(3) + ')';
  c.shadowColor = '#7CC4FF';
  c.shadowBlur = 8;
  c.lineWidth = 1.6;
  c.stroke();
  c.restore();
}
