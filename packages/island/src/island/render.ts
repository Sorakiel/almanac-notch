// The island preview: wallpaper, menu bar, the strip in three states, loupe (docs/SPEC.md 2.1-2.3).
import { clamp } from '../util/math';
import { rrect, type Ctx } from '../util/draw';
import type { IslandState } from '../sim/state';
import { statusOf } from '../sim/events';
import { closeCountdown, notchState } from './focus';
import { islandShape, islandTargets } from './geometry';
import { bootTrace, drawShine, islandFlash, shakeX, workFx } from './fx';
import { drawHalf } from './half';
import { drawOpen } from './open';

/**
 * proto: renderIsland. Draws into the offscreen context `oc`, then copies it into the island canvas `ic` and
 * the loupe region pixel for pixel into `lc`. The prototype drew at a fixed 2×; the scale now comes from
 * `oc`'s size, so a 125% or 150% Windows screen gets its own density instead of a blurry 2× downscale.
 */
export function renderIsland(s: IslandState, ic: Ctx, oc: Ctx, lc?: Ctx): void {
  const { IW, IH, S, sp } = s;
  const MB = s.mb;
  const c = oc,
    k = oc.canvas.width / IW;
  c.setTransform(k, 0, 0, k, 0, 0);
  if (s.bare) c.clearRect(0, 0, IW, IH);
  else {
    const wall = c.createLinearGradient(0, 0, IW, IH);
    wall.addColorStop(0, '#2E3442');
    wall.addColorStop(1, '#5A6276');
    c.fillStyle = wall;
    c.fillRect(0, 0, IW, IH);
    if (S.screen === 'mac') {
      // the menu bar exists only on the Mac; Windows keeps its taskbar at the bottom
      c.fillStyle = 'rgba(255,255,255,0.09)';
      c.fillRect(0, 0, IW, MB);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      [14, 50, 84, 116].forEach((x, i) => {
        if (x + 26 < IW * 0.28) {
          rrect(c, x, 13, i === 0 ? 14 : 26, 6, 3);
          c.fill();
        }
      });
      [IW - 46, IW - 72, IW - 92].forEach((x) => {
        if (x > IW * 0.72) {
          rrect(c, x, 12, 14, 8, 3);
          c.fill();
        }
      });
    }
  }

  const state = notchState(s);
  const st = statusOf(s),
    fx = workFx(s);
  c.font = '500 12px Onest, system-ui, sans-serif';
  const textW = st ? c.measureText(st.text).width : 0;
  const dotsW = fx && S.workfx === 'dots' ? 26 : 0;
  sp.halfA.t = state === 'half' ? 1 : 0;
  sp.openA.t = state === 'open' ? 1 : 0;
  // the open content reveals layer by layer from the moment the island starts to open
  if (state === 'open' && !s.drawnOpen) s.revealStart = s.t;
  s.drawnOpen = state === 'open';
  const halfA = clamp(sp.halfA.x, 0, 1),
    openA = clamp(sp.openA.x, 0, 1);
  const cx = IW / 2;
  s.mascotSpots = [];
  s.hits = [];
  s.islandMascot = null;

  {
    // one strip for both systems: on the Mac it grows out of the notch, on Windows there is no camera
    // and the closed state folds into a flat tile on the top edge
    const win = S.screen !== 'mac';
    const tg = islandTargets({
      IW,
      state,
      win,
      ratelimit: !!s.event && s.event.type === 'ratelimit',
      status: !!st,
      drop: !!st && !!st.drop,
      textW,
      dotsW,
      notchW: s.notchW,
      mb: MB,
    });
    sp.earL.t = tg.eL;
    sp.earR.t = tg.eR;
    sp.ih.t = tg.hh;
    sp.nw.t = tg.baseW;
    const nw = Math.max(60, sp.nw.x);
    const x0 = cx - nw / 2 - Math.max(0, sp.earL.x),
      x1 = cx + nw / 2 + Math.max(0, sp.earR.x);
    const h = Math.max(win ? 6 : MB, sp.ih.x),
      r = Math.min(h / 2, 10 + 12 * openA);
    const path = () => islandShape(c, x0, x1, h, r);
    path();
    c.fillStyle = '#000';
    c.fill();
    if (!win && !s.bare) {
      c.fillStyle = '#0B0C10';
      c.beginPath();
      c.arc(cx, 14, 3.4, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#1B1D25';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, 14, 3.4, 0, Math.PI * 2);
      c.stroke();
    }
    islandFlash(s, c, path);
    bootTrace(s, c, path, 2 * (x1 - x0) + 2 * h);
    c.save();
    path();
    c.clip();
    c.translate(shakeX(s), 0); // the strip is fixed to the edge: only the content shakes
    const closedA = clamp(1 - halfA - openA, 0, 1);
    if (win && closedA > 0.01) {
      c.save();
      c.globalAlpha = closedA;
      c.fillStyle = st && st.badge ? st.color : '#4A4D54';
      rrect(c, cx - 15, h / 2 - 1.5, 30, 3, 1.5);
      c.fill();
      c.restore();
    }
    if (halfA > 0.01) {
      c.save();
      c.globalAlpha = halfA;
      drawHalf(s, c, x0, { x: cx + nw / 2 + 9, x0, w: Math.max(0, sp.earR.x), end: x1 }, h, st, fx, 0);
      if (fx && S.workfx === 'shine') drawShine(s, c, fx, x0, x1, MB);
      c.restore();
    }
    if (openA > 0.01) {
      c.save();
      c.globalAlpha = openA;
      drawOpen(s, c, x0, x1, MB, h, st, fx, 16);
      c.restore();
    }
    drawCountdown(s, c, cx, h, openA);
    c.restore();
    s.islandBox = { x0, x1, y0: 0, y1: h };
  }

  const spot = s.mascotSpots.sort((a, b) => b.a - a.a)[0];
  if (spot && spot.a > 0.3) s.loupeRect = { x: spot.x - 42, y: Math.max(0, spot.y - 22), w: 84, h: 40 };
  else s.loupeRect = { x: cx - 42, y: 0, w: 84, h: 40 };

  const off = oc.canvas,
    island = ic.canvas;
  ic.setTransform(1, 0, 0, 1, 0, 0);
  ic.imageSmoothingEnabled = true;
  ic.clearRect(0, 0, island.width, island.height);
  ic.drawImage(off, 0, 0, off.width, off.height, 0, 0, island.width, island.height);
  if (!lc) return;
  const loupe = lc.canvas;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.imageSmoothingEnabled = false;
  lc.fillStyle = '#000';
  lc.fillRect(0, 0, loupe.width, loupe.height);
  const L = s.loupeRect;
  lc.drawImage(off, Math.max(0, L.x * k), Math.max(0, L.y * k), L.w * k, L.h * k, 0, 0, loupe.width, loupe.height);
}

/** the auto-close countdown's line and its fade, per island */
const countdowns = new WeakMap<IslandState, { a: number; w: number; t: number }>();

/**
 * A short quiet line on the open island's bottom edge that shrinks to the middle while the auto-close
 * runs out (closeCountdown). It fades in and out rather than popping, so a pointer coming back only
 * dims it away.
 */
function drawCountdown(s: IslandState, c: Ctx, cx: number, h: number, openA: number): void {
  let cd = countdowns.get(s);
  if (!cd) countdowns.set(s, (cd = { a: 0, w: 1, t: s.t }));
  const left = closeCountdown(s);
  const dt = clamp(s.t - cd.t, 0, 0.1);
  cd.t = s.t;
  cd.a += ((left == null ? 0 : 1) - cd.a) * (1 - Math.exp(-dt / 0.12));
  if (left != null) cd.w = left;
  if (cd.a < 0.01 || openA < 0.01) return;
  const W = 56 * cd.w;
  if (W < 0.5) return;
  c.save();
  c.globalAlpha *= cd.a * openA * 0.32;
  c.fillStyle = '#fff';
  rrect(c, cx - W / 2, h - 5, W, 2, 1);
  c.fill();
  c.restore();
}
