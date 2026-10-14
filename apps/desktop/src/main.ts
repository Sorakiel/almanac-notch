// Stage 1 stub: a black strip at the notch that opens to 480x150 on hover.
// The real island from packages/island replaces this in stage 3.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface Geometry {
  hasNotch: boolean;
  notchW: number;
  notchH: number;
  winW: number;
  winH: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const OPEN_W = 480;
const OPEN_H = 150;
// No-notch screens: flat tile at the top edge (SPEC: Windows closed state 96x9).
const TILE_W = 96;
const TILE_H = 9;
const RADIUS = 14;

const canvas = document.getElementById('island') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

let geo: Geometry = { hasNotch: false, notchW: 190, notchH: 32, winW: 520, winH: 190 };
let hover = false;
let clicks = 0;
let flash = 0;
// Current strip size; eased toward the target. Placeholder motion, not the prototype springs.
let w = 0;
let h = 0;
let raf = 0;
let last = 0;

function closedSize(): { w: number; h: number } {
  return geo.hasNotch ? { w: geo.notchW, h: geo.notchH } : { w: TILE_W, h: TILE_H };
}

function targetSize(): { w: number; h: number } {
  return hover ? { w: Math.min(OPEN_W, geo.winW - 24), h: OPEN_H } : closedSize();
}

function centered(rw: number, rh: number): Rect {
  return { x: (geo.winW - rw) / 2, y: 0, w: rw, h: rh };
}

async function pushHitRects(): Promise<void> {
  const c = closedSize();
  // On a notch the closed hover zone is the notch itself; the tile is too thin to hit, so pad it.
  const closed = geo.hasNotch ? centered(c.w, c.h) : centered(c.w + 40, c.h + 6);
  const t = { w: Math.min(OPEN_W, geo.winW - 24), h: OPEN_H };
  await invoke('set_hit_rects', { closed, open: centered(t.w, t.h) });
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(geo.winW * dpr);
  canvas.height = Math.round(geo.winH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw(): void {
  ctx.clearRect(0, 0, geo.winW, geo.winH);
  const r = centered(w, h);
  const rad = Math.min(RADIUS, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(r.x, 0);
  ctx.lineTo(r.x + r.w, 0);
  ctx.lineTo(r.x + r.w, r.h - rad);
  ctx.quadraticCurveTo(r.x + r.w, r.h, r.x + r.w - rad, r.h);
  ctx.lineTo(r.x + rad, r.h);
  ctx.quadraticCurveTo(r.x, r.h, r.x, r.h - rad);
  ctx.closePath();
  ctx.fillStyle = '#000';
  ctx.fill();
  // Debug outline so the stub is visible over the black notch in recordings.
  ctx.strokeStyle = flash > 0 ? 'rgba(255,122,61,0.95)' : 'rgba(120,124,135,0.9)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (h > 60) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const note = geo.hasNotch ? `notch ${geo.notchW.toFixed(0)}×${geo.notchH.toFixed(0)}` : 'no notch';
    ctx.fillText(`stage 1 stub · ${note} · clicks ${clicks}`, geo.winW / 2, r.h - 20);
  }
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const t = targetSize();
  const k = 1 - Math.exp(-dt * 18);
  w += (t.w - w) * k;
  h += (t.h - h) * k;
  flash = Math.max(0, flash - dt);
  const settled = Math.abs(t.w - w) < 0.3 && Math.abs(t.h - h) < 0.3 && flash === 0;
  if (settled) {
    w = t.w;
    h = t.h;
  }
  draw();
  // Idle = no rAF, so the closed strip costs nothing.
  raf = settled ? 0 : requestAnimationFrame(frame);
}

function kick(): void {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function applyGeometry(g: Geometry): void {
  geo = g;
  const c = closedSize();
  if (w === 0) {
    w = c.w;
    h = c.h;
  }
  resize();
  draw();
  kick();
  void pushHitRects();
}

canvas.addEventListener('mousedown', () => {
  clicks += 1;
  flash = 0.25;
  kick();
});

await listen<Geometry>('island://geometry', (e) => applyGeometry(e.payload));
await listen<boolean>('island://hover', (e) => {
  hover = e.payload;
  kick();
});
applyGeometry(await invoke<Geometry>('island_geometry'));
