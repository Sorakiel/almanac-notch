// Card building blocks of the open island: plate, tint, the card mascot, keyboard buttons.
import { hoverK, pressScale } from './hover';
import { hexA, mixHex } from '../util/math';
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
      const base = colKey ? MODULE_COL[colKey].body : '#8FA8FF',
        hc = haloTint.k > 0 ? mixHex(base, haloTint.color, 0.75 * haloTint.k) : base,
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
 * The light comes from the rim, not from a fill: an inner glow along the card's own edge, in the
 * lower part only, stronger at the corners and up the sides than along the bottom middle, so the
 * card under the text stays dark and the text keeps its contrast; the prototype's wash over the whole card flattened it. The top
 * stays dark (owner, 2026-10-19). The mascot's halo takes the same colour (haloTint), so the
 * mascot reads as being in that state rather than lit by its own module colour. */
export function cardTint(c: Ctx, x: number, y: number, w: number, h: number, color: string, strength: number): void {
  const a = Math.min(0.85, strength * 1.9);
  haloTint.color = color;
  haloTint.k = Math.min(1, strength / 0.4);
  if (typeof document === 'undefined' || a < 0.01) return;
  // the light follows the card's own edge (an inner glow), drawn in device pixels on a side
  // canvas and then masked: no shapes of its own, so no circles or bands show
  const m = c.getTransform(),
    px = Math.hypot(m.a, m.b),
    dx = m.a * x + m.c * y + m.e,
    dy = m.b * x + m.d * y + m.f,
    W = Math.ceil(w * px),
    H = Math.ceil(h * px);
  if (W < 2 || H < 2) return;
  tintCanvas ??= document.createElement('canvas');
  const cv = tintCanvas;
  if (cv.width < W) cv.width = W;
  if (cv.height < H) cv.height = H;
  const o = cv.getContext('2d');
  if (!o) return;
  // the same card in the same light as last frame: the side canvas already holds it
  const key = `${W}x${H}:${color}:${a.toFixed(3)}:${px}`;
  if (key !== tintKey) {
    tintKey = key;
    paintTint(o, cv, W, H, px, color, a);
  }
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(cv, 0, 0, W, H, dx, dy, W, H);
  c.restore();
}

function paintTint(
  o: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  W: number,
  H: number,
  px: number,
  color: string,
  a: number,
): void {
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, cv.width, cv.height);
  o.save();
  rrect(o as unknown as Ctx, 0, 0, W, H, 14 * px);
  o.clip();
  // the frame's shadow: a faint rim and a wide soft light inside it (no hard line at the edge)
  const rim = (blur: number, alpha: number): void => {
    o.shadowColor = hexA(color, alpha);
    o.shadowBlur = blur;
    o.fillStyle = '#000';
    o.beginPath();
    o.rect(-200, -200, W + 400, H + 400);
    rrectSub(o as unknown as Ctx, 0, 0, W, H, 14 * px);
    o.fill('evenodd');
  };
  rim(24 * px, a * 0.35);
  rim(H * 0.55, a * 0.85);
  o.restore();
  o.shadowColor = 'transparent';
  // masks multiply: dark on the top, the light in the lower part only...
  o.globalCompositeOperation = 'destination-in';
  const v = o.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.3, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,1)');
  o.fillStyle = v;
  o.fillRect(0, 0, W, H);
  // ...and quieter along the bottom middle than at the corners
  const hz = o.createLinearGradient(0, 0, W, 0);
  hz.addColorStop(0, 'rgba(0,0,0,1)');
  hz.addColorStop(0.25, 'rgba(0,0,0,0.5)');
  hz.addColorStop(0.5, 'rgba(0,0,0,0.32)');
  hz.addColorStop(0.75, 'rgba(0,0,0,0.5)');
  hz.addColorStop(1, 'rgba(0,0,0,1)');
  o.fillStyle = hz;
  o.fillRect(0, 0, W, H);
  o.globalCompositeOperation = 'source-over';
}

let tintCanvas: HTMLCanvasElement | null = null,
  tintKey = '';

/** the state colour the card mascot's halo takes on a tinted card; reset every frame */
export const haloTint = { color: '', k: 0 };

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
  // no shortcut (the panel never takes the keyboard outside prompts): the label alone
  const kw = key ? 16 : 0,
    total = key ? lw + 6 + kw : lw,
    lx = x + (w - total) / 2;
  textAt(c, label, lx, y + h / 2 + 0.5, { size: 12, color: primary ? '#000' : 'rgba(255,255,255,0.92)' });
  if (!key) {
    c.restore();
    addHit(s, c, { x, y, w, h, act });
    return;
  }
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
