// Clickable zones of the island, rebuilt on every frame.
import { hoverK, pressScale } from './hover';
import type { Ctx } from '../util/draw';
import { rrect, textAt } from '../util/draw';
import type { Hit, IslandState } from '../sim/state';

/** proto: addHit - only zones that are clearly visible are clickable */
export function addHit(s: IslandState, c: Ctx, h: Hit): void {
  if (c.globalAlpha > 0.6) s.hits.push(h);
}

/** proto: hovering */
export function hovering(s: IslandState, x: number, y: number, w: number, h: number): boolean {
  const p = s.islandPtr;
  return !!p && p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}

/** proto: hitAt - topmost zone under the point */
export function hitAt(s: IslandState, p: { x: number; y: number }): Hit | null {
  for (let i = s.hits.length - 1; i >= 0; i--) {
    const h = s.hits[i] as Hit;
    if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h;
  }
  return null;
}

/** proto: button */
export function button(
  s: IslandState,
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  act: string,
  primary: boolean,
): void {
  const hk = Math.min(1, hoverK(s, 'btn:' + act, hovering(s, x, y, w, h), 0.2, 1)),
    sc = pressScale(s, act);
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.scale(sc, sc);
  c.translate(-(x + w / 2), -(y + h / 2));
  c.fillStyle = primary
    ? `rgb(${255 - 25 * hk},${255 - 25 * hk},${255 - 25 * hk})`
    : `rgba(255,255,255,${(0.12 + 0.08 * hk).toFixed(3)})`;
  rrect(c, x, y, w, h, h / 2);
  c.fill();
  textAt(c, label, x + w / 2, y + h / 2 + 0.5, {
    size: 11.5,
    align: 'center',
    color: primary ? '#000' : 'rgba(255,255,255,0.92)',
  });
  c.restore();
  addHit(s, c, { x, y, w, h, act });
}

/** Draw at scale k around (ox, oy), keeping clicks, hover and the mascot's spots in island
 * coordinates: the hits and spots drawn inside are mapped back, the pointer is mapped in. */
export function withScale(s: IslandState, c: Ctx, ox: number, oy: number, k: number, draw: () => void): void {
  if (k === 1) return draw();
  const fx = (x: number) => ox + (x - ox) * k,
    fy = (y: number) => oy + (y - oy) * k;
  const ptr = s.islandPtr,
    nh = s.hits.length,
    ns = s.mascotSpots.length,
    im = s.islandMascot;
  if (ptr) s.islandPtr = { x: ox + (ptr.x - ox) / k, y: oy + (ptr.y - oy) / k };
  c.save();
  c.translate(ox, oy);
  c.scale(k, k);
  c.translate(-ox, -oy);
  try {
    draw();
  } finally {
    c.restore();
    s.islandPtr = ptr;
  }
  for (let i = nh; i < s.hits.length; i++) {
    const h = s.hits[i] as Hit;
    s.hits[i] = {
      ...h,
      x: fx(h.x),
      y: fy(h.y),
      w: h.w * k,
      h: h.h * k,
      ...(h.cx !== undefined ? { cx: fx(h.cx) } : {}),
      ...(h.cy !== undefined ? { cy: fy(h.cy) } : {}),
      ...(h.R !== undefined ? { R: h.R * k } : {}),
    };
  }
  for (let i = ns; i < s.mascotSpots.length; i++) {
    const p = s.mascotSpots[i];
    if (p) s.mascotSpots[i] = { ...p, x: fx(p.x), y: fy(p.y) };
  }
  if (s.islandMascot && s.islandMascot !== im) {
    const m = s.islandMascot;
    s.islandMascot = { x: fx(m.x), y: fy(m.y), R: m.R * k };
  }
}

/** Draw shifted by (dx, dy), keeping clicks, hover and the mascot's spots in island coordinates,
 * as withScale does for a scale: a level of a card sliding in or out (island/depth.ts). */
export function withShift(s: IslandState, c: Ctx, dx: number, dy: number, draw: () => void): void {
  if (dx === 0 && dy === 0) return draw();
  const ptr = s.islandPtr,
    nh = s.hits.length,
    ns = s.mascotSpots.length;
  if (ptr) s.islandPtr = { x: ptr.x - dx, y: ptr.y - dy };
  c.save();
  c.translate(dx, dy);
  try {
    draw();
  } finally {
    c.restore();
    s.islandPtr = ptr;
  }
  for (let i = nh; i < s.hits.length; i++) {
    const h = s.hits[i] as Hit;
    s.hits[i] = {
      ...h,
      x: h.x + dx,
      y: h.y + dy,
      ...(h.cx !== undefined ? { cx: h.cx + dx } : {}),
      ...(h.cy !== undefined ? { cy: h.cy + dy } : {}),
      ...(h.bx0 !== undefined ? { bx0: h.bx0 + dx } : {}),
      ...(h.bx1 !== undefined ? { bx1: h.bx1 + dx } : {}),
    };
  }
  for (let i = ns; i < s.mascotSpots.length; i++) {
    const p = s.mascotSpots[i];
    if (p) s.mascotSpots[i] = { ...p, x: p.x + dx, y: p.y + dy };
  }
}
