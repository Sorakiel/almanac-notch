import { clamp } from '../util/math';
import { bodyField } from '../mascot/shape';
import type { IslandState } from './state';

/** where the mascot is drawn: the big stage, the notch ear or a module card */
export type Mini = false | 'notch' | 'card';

export interface Pose {
  cx: number;
  gy: number;
  R: number;
  b: number;
  sx: number;
  sy: number;
  px: number;
  py: number;
  hide: number;
  ax: number;
  ay: number;
  lean: number;
  air: number;
  mini: Mini;
}

/** proto: geo - the big stage mascot */
export function geo(s: IslandState) {
  const R = clamp(Math.min(s.W, s.H) * 0.16, 46, 90);
  return { R, b: R * 0.92, cx: s.W / 2, gy: s.H * 0.74 };
}

/** proto: pose - breathing, volume-preserving squash, position, hiding */
export function pose(s: IslandState, cx: number, gy: number, R: number, mini: Mini): Pose {
  const { sp, S } = s;
  const b = R * 0.92;
  const amp = (s.sleeping ? 0.03 : 0.016) * S.breath * (S.reduced ? 0.4 : 1);
  const sy = sp.sq.x * (1 + amp * Math.sin((s.t * 2 * Math.PI) / (s.sleeping ? 5.2 : 3.6)));
  const sx = Math.pow(Math.max(sy, 0.3), -0.6) * (1 + sp.puff.x * 0.06);
  let px = sp.posX.x,
    py = sp.posY.x;
  if (mini) {
    px = clamp(px * 0.15, -0.35, 0.35);
    py = clamp(py * 0.35, -0.45, 0);
  }
  const hide = clamp(sp.hide.x, 0, 1.2);
  const ax = cx + px * R,
    ay = gy + py * R + hide * b * sy * (mini ? 0.55 : 1);
  return { cx, gy, R, b, sx, sy, px, py, hide, ax, ay, lean: sp.lean.x, air: clamp(-py / 1.2, 0, 1), mini };
}

/** proto: toLocal - world -> body-local (centre origin, before squash) */
export function toLocal(P: Pose, x: number, y: number): [number, number] {
  const dx = x - P.ax,
    dy = y - P.ay,
    co = Math.cos(-P.lean),
    si = Math.sin(-P.lean);
  const qx = dx * co - dy * si,
    qy = dx * si + dy * co;
  return [qx / P.sx, qy / P.sy + P.b];
}

/** proto: toWorld */
export function toWorld(P: Pose, lx: number, ly: number): [number, number] {
  const x = lx * P.sx,
    y = (ly - P.b) * P.sy,
    co = Math.cos(P.lean),
    si = Math.sin(P.lean);
  return [P.ax + x * co - y * si, P.ay + x * si + y * co];
}

export interface Eye {
  side: number;
  ex: number;
  ey: number;
  w: number;
  h: number;
  eh: number;
}
export interface Eyes {
  list: Eye[];
  happy: number;
  grump: number;
}

/** proto: eyesOf - eye geometry from the springs */
export function eyesOf(s: IslandState, P: Pose): Eyes {
  const { sp, S } = s;
  const R = P.R,
    b = P.b;
  const lx = clamp(sp.lookX.x, -1.5, 1.5),
    ly = clamp(sp.lookY.x, -1.5, 1.5);
  const wide = clamp(sp.wide.x, -0.3, 1.3),
    open = clamp(sp.lid.x, 0, 1.1);
  const boost = S.eyeSize * (P.mini === 'notch' ? S.notchEye : P.mini === 'card' ? 1.12 : 1);
  const fx = Math.sin(lx * 0.95) * R * 0.19,
    fy = Math.sin(ly * 0.95) * b * 0.26,
    down = Math.max(0, ly);
  const spacing = R * 0.46 * (0.72 + 0.28 * boost) * (1 - 0.1 * Math.abs(lx));
  const ew = R * 0.19 * boost * (1 + 0.18 * wide),
    eh = R * 0.4 * boost * (1 + 0.14 * wide);
  const list: Eye[] = [];
  for (const side of [-1, 1]) {
    const persp = 1 - 0.24 * Math.max(0, side * lx);
    const vk = 1 - 0.2 * Math.abs(ly);
    list.push({
      side,
      ex: fx + (side * spacing) / 2,
      ey: fy - b * 0.04 + eh * 0.1 * down,
      w: ew * persp,
      h: Math.max(eh * open * vk, R * 0.055),
      eh: eh * vk,
    });
  }
  return { list, happy: clamp(sp.happy.x, 0, 1), grump: clamp(sp.grump.x, 0, 1) };
}

/** proto: hitBody - is a stage point inside the (slightly enlarged) body */
export function hitBody(s: IslandState, x: number, y: number) {
  const G = geo(s),
    P = pose(s, G.cx, G.gy, G.R, false);
  const [lx, ly] = toLocal(P, x, y);
  return { inside: bodyField(lx, ly, G.R * 1.05, G.b * 1.05) < 1, lx: lx / G.R, ly: ly / G.b, P };
}
