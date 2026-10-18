// Card building blocks of the open island: plate, tint, the card mascot, keyboard buttons.
import { hexA } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState, ModuleId } from '../sim/state';
import { drawMascot } from '../mascot/body';
import { mascotMarks } from '../mascot/marks';
import { drawProp, type PropKind } from '../mascot/props';
import type { WorkFx } from './fx';
import { MODULE_COL } from './focus';
import { addHit, hovering } from './hits';

/** proto: card */
export function card(c: Ctx, x: number, y: number, w: number, h: number, hot: boolean): void {
  c.fillStyle = hot ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.06)';
  rrect(c, x, y, w, h, 14);
  c.fill();
}

/** proto: cardMascot - centred vertically in the card */
export function cardMascot(
  s: IslandState,
  c: Ctx,
  x0: number,
  y0: number,
  y1: number,
  colKey: ModuleId | null,
  fx: WorkFx | null,
  prop?: PropKind | null,
): void {
  const R = 23,
    mx = x0 + 42,
    mcy = (y0 + y1) / 2 + 2,
    gy = mcy + R * 0.92;
  mascotMarks(s, c, fx, mx, mcy, R, false);
  const P = drawMascot(s, c, mx, gy, R, 'card', '#141415', colKey ? MODULE_COL[colKey] : null);
  if (prop) drawProp(s, c, prop, P, (colKey && MODULE_COL[colKey]) || null);
  mascotMarks(s, c, fx, mx, mcy, R, true);
  s.mascotSpots.push({ x: mx, y: gy - R, a: c.globalAlpha });
  if (c.globalAlpha > 0.5) s.islandMascot = { x: mx, y: mcy, R };
  addHit(s, c, { x: mx - R * 1.1, y: gy - R * 2, w: R * 2.2, h: R * 2, act: 'mascot', cx: mx, cy: mcy, R });
}

/** proto: cardTint - a soft wash of the state's colour from the card's lower left corner */
export function cardTint(c: Ctx, x: number, y: number, w: number, h: number, color: string, strength: number): void {
  const g = c.createRadialGradient(x + w * 0.18, y + h * 1.05, 0, x + w * 0.18, y + h * 1.05, Math.max(w, h) * 0.95);
  g.addColorStop(0, hexA(color, strength));
  g.addColorStop(1, hexA(color, 0));
  c.save();
  rrect(c, x, y, w, h, 14);
  c.clip();
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.restore();
}

/** proto: kbdButton - a pill button with its keyboard shortcut */
export function kbdButton(
  s: IslandState,
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  key: string,
  act: string,
  primary: boolean,
): void {
  const hov = hovering(s, x, y, w, h);
  c.fillStyle = primary ? (hov ? '#E8E8E8' : '#FFFFFF') : hov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)';
  rrect(c, x, y, w, h, h / 2);
  c.fill();
  c.save();
  c.font = '500 12px Onest, system-ui, sans-serif';
  const lw = c.measureText(label).width;
  c.restore();
  const kw = 16,
    total = lw + 6 + kw,
    lx = x + (w - total) / 2;
  textAt(c, label, lx, y + h / 2 + 0.5, { size: 12, color: primary ? '#000' : 'rgba(255,255,255,0.92)' });
  c.strokeStyle = primary ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)';
  c.lineWidth = 1;
  rrect(c, lx + lw + 6, y + h / 2 - 7, kw, 14, 4);
  c.stroke();
  textAt(c, key, lx + lw + 6 + kw / 2, y + h / 2 + 0.5, {
    size: 9.5,
    mono: true,
    align: 'center',
    color: primary ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.65)',
  });
  addHit(s, c, { x, y, w, h, act });
}
