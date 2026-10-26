// The big stage from the prototype page: render and pointer handling, without DOM listeners.
import { clamp } from './util/math';
import type { Ctx } from './util/draw';
import { after, type IslandState } from './sim/state';
import { geo, hitBody } from './sim/pose';
import { hop, poke, wake } from './sim/actions';
import { burst } from './sim/particles';
import { drawMascot } from './mascot/body';
import { drawProp } from './mascot/props';
import { drawOverhead } from './mascot/marks';
import { drawParticles } from './mascot/particles';

/** proto: render - stage background, ground line, mascot, overhead marks, particles, debug hit zone */
export function renderStage(s: IslandState, sc: Ctx, dpr: number): void {
  const { W, H, theme } = s;
  const G = geo(s);
  sc.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = sc.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, theme.top);
  bg.addColorStop(1, theme.bot);
  sc.fillStyle = bg;
  sc.fillRect(0, 0, W, H);
  sc.fillStyle = theme.ground;
  sc.fillRect(0, G.gy, W, 1);
  const look = s.stageLook;
  const P = drawMascot(s, sc, G.cx, G.gy, G.R, false, theme.top, look?.col ?? null);
  // dressed as a module (settings headers, stage 9f): its prop, as on the island's card
  if (look?.prop && !s.sleeping) drawProp(s, sc, look.prop, P, look.col);
  drawOverhead(s, sc, P);
  drawParticles(s, sc, G.cx, G.gy, G.R);
  if (s.S.debug) {
    sc.save();
    sc.translate(P.ax, P.ay);
    sc.rotate(P.lean);
    sc.scale(P.sx, P.sy);
    sc.translate(0, -P.b);
    sc.setLineDash([4, 4]);
    sc.strokeStyle = '#FF453A';
    sc.lineWidth = 1 / P.sx;
    sc.beginPath();
    sc.ellipse(0, 0, G.R * 1.05, G.b * 1.05, 0, 0, Math.PI * 2);
    sc.stroke();
    sc.restore();
  }
}

/** proto: stage.style.cursor at the end of render */
export function stageCursor(s: IslandState): string {
  return s.grab && s.grab.active ? 'grabbing' : hitBody(s, s.ptr.x, s.ptr.y).inside ? 'grab' : 'default';
}

export interface Point {
  x: number;
  y: number;
}

/** proto: window pointermove - p is relative to the stage canvas, now in ms */
export function stagePointerMove(s: IslandState, p: Point, now: number): void {
  const ptr = s.ptr;
  const dtr = Math.max(1, now - ptr.lastT) / 1000;
  const inst = Math.hypot(p.x - ptr.x, p.y - ptr.y) / dtr;
  ptr.speed = ptr.seen ? ptr.speed * 0.6 + Math.min(inst, 5000) * 0.4 : 0;
  ptr.x = p.x;
  ptr.y = p.y;
  ptr.lastT = now;
  ptr.lastMoveReal = now;
  ptr.seen = true;
  if (s.sleeping && !s.forcedSleep) wake(s, true);
  const grab = s.grab;
  if (grab) {
    const G = geo(s);
    if (!grab.active && Math.hypot(p.x - grab.sx, p.y - grab.sy) > 6) grab.active = true;
    if (grab.active) {
      grab.tx = clamp((p.x - grab.ox - G.cx) / G.R, -(s.W / 2 - G.R * 1.1) / G.R, (s.W / 2 - G.R * 1.1) / G.R);
      grab.ty = clamp((p.y - grab.oy - G.gy) / G.R, -(G.gy - G.b * 2.4) / G.R, 0);
      grab.vx = grab.vx * 0.7 + ((p.x - grab.lx) / dtr) * 0.3;
      grab.vy = grab.vy * 0.7 + ((p.y - grab.ly) / dtr) * 0.3;
    }
    grab.lx = p.x;
    grab.ly = p.y;
  }
}

/** proto: stage pointerdown - returns true when the body was hit (the caller captures the pointer) */
export function stagePointerDown(s: IslandState, p: Point, now: number): boolean {
  const ptr = s.ptr;
  ptr.down = true;
  ptr.x = p.x;
  ptr.y = p.y;
  ptr.seen = true;
  ptr.lastMoveReal = now;
  const G = geo(s),
    hb = hitBody(s, p.x, p.y);
  if (!hb.inside) return false;
  s.grab = {
    active: false,
    sx: p.x,
    sy: p.y,
    lx: p.x,
    ly: p.y,
    vx: 0,
    vy: 0,
    ox: p.x - (G.cx + s.sp.posX.x * G.R),
    oy: p.y - (G.gy + s.sp.posY.x * G.R),
    plx: hb.lx,
    ply: hb.ly,
    tx: s.sp.posX.x,
    ty: s.sp.posY.x,
  };
  return true;
}

/** proto: release - pointerup / pointercancel: throw with inertia, or a poke if it never became a drag */
export function stageRelease(s: IslandState): void {
  s.ptr.down = false;
  const grab = s.grab;
  if (!grab) return;
  const G = geo(s),
    sp = s.sp;
  if (grab.active) {
    sp.posX.v += clamp(grab.vx / G.R, -12, 12) * 0.35;
    sp.posY.v = clamp(grab.vy / G.R, -10, 6) * 0.5;
    if (sp.posY.x > -0.01 && sp.posY.v >= 0) sp.posY.v = 0;
  } else poke(s, grab.plx, grab.ply);
  s.grab = null;
}

/** proto: stage dblclick - joy */
export function stageDoubleClick(s: IslandState, p: Point): void {
  if (!hitBody(s, p.x, p.y).inside) return;
  s.pokes = [];
  s.grumpyUntil = 0;
  s.hideUntil = 0;
  s.happyUntil = s.t + 1.1;
  hop(s, 5.6);
  after(s, 0.3, () => burst(s, 8, '#FFFFFF'));
}
