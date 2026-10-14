import { clamp } from '../util/math';
import type { Ctx } from '../util/draw';

/** proto: N_EXP - superellipse exponent of the egg */
export const N_EXP = 2.3;

/** proto: widthAt - the egg is slightly narrower at the top (yn = -1) */
export const widthAt = (yn: number): number => (yn > 0 ? 1 + 0.05 * yn : 1 - 0.13 * yn * yn);

/** proto: BODY - 80 outline points in unit space */
export const BODY: readonly (readonly [number, number])[] = (() => {
  const pts: [number, number][] = [],
    N = 80;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2,
      c = Math.cos(th),
      s = Math.sin(th);
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / N_EXP);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / N_EXP) * widthAt(y);
    pts.push([x, y]);
  }
  return pts;
})();

const pt = (i: number) => BODY[i % BODY.length] as readonly [number, number];

/** proto: bodyPath - quadratic curves through the segment midpoints */
export function bodyPath(c: Ctx, R: number, b: number): void {
  const N = BODY.length;
  const mid = (i: number): [number, number] => {
    const a = pt(i),
      q = pt(i + 1);
    return [((a[0] + q[0]) / 2) * R, ((a[1] + q[1]) / 2) * b];
  };
  c.beginPath();
  let m = mid(0);
  c.moveTo(m[0], m[1]);
  for (let i = 1; i <= N; i++) {
    const q = pt(i);
    m = mid(i);
    c.quadraticCurveTo(q[0] * R, q[1] * b, m[0], m[1]);
  }
  c.closePath();
}

/** proto: bodyField - < 1 inside, 1 on the edge */
export function bodyField(px: number, py: number, R: number, b: number): number {
  const yn = clamp(py / b, -1.5, 1.5);
  const ax = Math.abs(px / (R * widthAt(clamp(yn, -1, 1)))),
    ay = Math.abs(yn);
  return Math.pow(Math.pow(ax, N_EXP) + Math.pow(ay, N_EXP), 1 / N_EXP);
}
