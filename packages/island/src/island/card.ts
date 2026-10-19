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
  // 2026-10-19: a step lighter, as Grok Bot's - the cards read as surfaces on the island, not holes
  c.fillStyle = hot ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.075)';
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
  // a soft halo of the module's colour behind the mascot (Grok Bot, coucou): the card's light source
  // (Almanac's own mascot has no module colour: a cool blue, as Grok Bot's white mascot)
  {
    const hc = colKey ? MODULE_COL[colKey].body : '#8FA8FF',
      hr = R * 2.3,
      g = c.createRadialGradient(mx, mcy, R * 0.4, mx, mcy, hr);
    g.addColorStop(0, hexA(hc, colKey ? 0.26 : 0.2));
    g.addColorStop(1, hexA(hc, 0));
    c.fillStyle = g;
    c.fillRect(mx - hr, mcy - hr, hr * 2, hr * 2);
  }
  mascotMarks(s, c, fx, mx, mcy, R, false);
  const P = drawMascot(s, c, mx, gy, R, 'card', '#141415', colKey ? MODULE_COL[colKey] : null);
  if (prop) drawProp(s, c, prop, P, (colKey && MODULE_COL[colKey]) || null);
  mascotMarks(s, c, fx, mx, mcy, R, true);
  s.mascotSpots.push({ x: mx, y: gy - R, a: c.globalAlpha });
  if (c.globalAlpha > 0.5) s.islandMascot = { x: mx, y: mcy, R };
  addHit(s, c, { x: mx - R * 1.1, y: gy - R * 2, w: R * 2.2, h: R * 2, act: 'mascot', cx: mx, cy: mcy, R });
}

/** proto: cardTint - the state's colour as light at the card's edges (docs/CHANGES.md 2026-10-19).
 * Grok Bot's cards stay dark and glow at their rim, most at the bottom edge and its corners; the
 * prototype's wash over the whole card read loud and flattened the text on it. Drawn as the shadow
 * of shapes just outside the card, clipped to it, so the light bleeds in from the border. */
export function cardTint(c: Ctx, x: number, y: number, w: number, h: number, color: string, strength: number): void {
  const a = Math.min(0.85, strength * 1.9),
    px = c.getTransform().a; // shadowBlur ignores the transform
  c.save();
  rrect(c, x, y, w, h, 14);
  c.clip();
  c.fillStyle = '#000';
  // the whole rim, faint
  c.shadowColor = hexA(color, a * 0.45);
  c.shadowBlur = 16 * px;
  c.beginPath();
  c.rect(x - 60, y - 60, w + 120, h + 120);
  rrect(c, x, y, w, h, 14);
  c.fill('evenodd');
  // the bottom edge, stronger and taller
  c.shadowColor = hexA(color, a);
  c.shadowBlur = h * 0.55 * px;
  c.fillRect(x - 10, y + h + 1, w + 20, 40);
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
