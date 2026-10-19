// Card building blocks of the open island: plate, tint, the card mascot, keyboard buttons.
import { hoverK, pressScale } from './hover';
import { hexA } from '../util/math';
import { rrect, rrectSub, textAt, type Ctx } from '../util/draw';
import type { IslandState, ModuleId } from '../sim/state';
import { drawMascot } from '../mascot/body';
import { mascotMarks } from '../mascot/marks';
import { drawProp, type PropKind } from '../mascot/props';
import type { WorkFx } from './fx';
import { MODULE_COL } from './focus';
import { addHit, hovering } from './hits';
import { cardFade, drawLate, flyMascot, markSpot } from './flight';

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
  const body = (x: number, y: number, r: number, halo: number): void => {
    // a soft halo of the module's colour behind the mascot (Grok Bot, coucou): the card's light source
    // (Almanac's own mascot has no module colour: a cool blue, as Grok Bot's white mascot)
    if (halo > 0.01) {
      const hc = colKey ? MODULE_COL[colKey].body : '#8FA8FF',
        hr = r * 2.3,
        g = c.createRadialGradient(x, y, r * 0.4, x, y, hr);
      g.addColorStop(0, hexA(hc, (colKey ? 0.26 : 0.2) * halo));
      g.addColorStop(1, hexA(hc, 0));
      c.fillStyle = g;
      c.fillRect(x - hr, y - hr, hr * 2, hr * 2);
    }
    mascotMarks(s, c, fx, x, y, r, false);
    const P = drawMascot(s, c, x, y + r * 0.92, r, 'card', '#141415', colKey ? MODULE_COL[colKey] : null);
    if (prop) drawProp(s, c, prop, P, (colKey && MODULE_COL[colKey]) || null);
    mascotMarks(s, c, fx, x, y, r, true);
  };
  // a focus change: the mascot flies in from the pill it was in, on top of the whole view and at
  // the card's alpha before its text fades in (island/flight.ts)
  // the old view fading out under an event: its mascot is already on its way to the rail
  if (cardFade.hide) return;
  const fl = colKey && flyMascot(s, c, colKey, mx, mcy, R);
  if (fl) drawLate(c, () => body(fl.x, fl.y, fl.R, Math.min(1, fl.k)), cardFade.a >= 0 ? cardFade.a : c.globalAlpha);
  else if (cardFade.a >= 0) {
    // the same mascot stays: it does not fade in with the card's new text
    c.save();
    c.globalAlpha = cardFade.a;
    body(mx, mcy, R, 1);
    c.restore();
  } else body(mx, mcy, R, 1);
  // where it is drawn, not where it lands: a second click mid-flight starts from here
  if (colKey) markSpot(s, c, colKey, fl ? fl.x : mx, fl ? fl.y : mcy, fl ? fl.R : R);
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
  // the whole rim, faint: Grok Bot's top edge stays almost dark, the light pools at the bottom
  c.shadowColor = hexA(color, a * 0.2);
  c.shadowBlur = 16 * px;
  // the frame around the card, the card a hole in it (rrect would start a new path and paint the
  // whole card black - the tinted cards were dark holes until 2026-10-19)
  c.beginPath();
  c.rect(x - 60, y - 60, w + 120, h + 120);
  rrectSub(c, x, y, w, h, 14);
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
  // hover fades in on a spring, a press sinks to 0.94 (coucou, 2026-10-19)
  const hk = Math.min(1, hoverK(s, 'btn:' + act, hovering(s, x, y, w, h), 0.2, 1)),
    sc = pressScale(s, act);
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.scale(sc, sc);
  c.translate(-(x + w / 2), -(y + h / 2));
  c.fillStyle = primary
    ? `rgb(${255 - 23 * hk},${255 - 23 * hk},${255 - 23 * hk})`
    : `rgba(255,255,255,${(0.12 + 0.08 * hk).toFixed(3)})`;
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
  c.restore();
  addHit(s, c, { x, y, w, h, act });
}
