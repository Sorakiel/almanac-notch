// Clickable zones of the island, rebuilt on every frame.
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
  const hov = hovering(s, x, y, w, h);
  c.fillStyle = primary ? (hov ? '#E6E6E6' : '#FFFFFF') : hov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)';
  rrect(c, x, y, w, h, h / 2);
  c.fill();
  textAt(c, label, x + w / 2, y + h / 2 + 0.5, {
    size: 11.5,
    align: 'center',
    color: primary ? '#000' : 'rgba(255,255,255,0.92)',
  });
  addHit(s, c, { x, y, w, h, act });
}
