// The non-home tabs of the open island: chat, add a module, settings (docs/SPEC.md 2.6).
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState } from '../sim/state';
import { addHit, hovering } from './hits';
import { T_MUTED } from './half';
import { card, cardMascot } from './card';

/** proto: drawChat */
export function drawChat(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number): void {
  const lw = 112;
  card(c, X0, y0, lw, y1 - y0, false);
  cardMascot(s, c, X0 + 14, y0, y1, null, null);
  const cx0 = X0 + lw + 8;
  c.fillStyle = 'rgba(255,255,255,0.08)';
  rrect(c, cx0, y0 + 6, Math.min(220, X1 - cx0), 26, 13);
  c.fill();
  textAt(c, 'Привет! Чем помочь?', cx0 + 12, y0 + 19.5, { size: 12, weight: 400, max: X1 - cx0 - 24 });
  textAt(c, 'qwen3.5:4b · локально', X1 - 6, y1 - 42, { size: 11, weight: 400, color: T_MUTED, align: 'right' });
  c.fillStyle = 'rgba(255,255,255,0.08)';
  rrect(c, cx0, y1 - 32, X1 - cx0, 32, 16);
  c.fill();
  textAt(c, 'Спроси что-нибудь…', cx0 + 14, y1 - 15.5, { size: 12, weight: 400, color: 'rgba(255,255,255,0.4)' });
  c.fillStyle = '#FFFFFF';
  c.beginPath();
  c.arc(X1 - 16, y1 - 16, 11, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#000';
  c.lineWidth = 1.6;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(X1 - 16, y1 - 11);
  c.lineTo(X1 - 16, y1 - 21);
  c.moveTo(X1 - 20, y1 - 17);
  c.lineTo(X1 - 16, y1 - 21);
  c.lineTo(X1 - 12, y1 - 17);
  c.stroke();
}

/** proto: drawAdd */
export function drawAdd(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number): void {
  const list = ['Почта', 'Notion', 'Obsidian', 'n8n', 'Vercel', 'Grafana'];
  const gap = 8,
    w = (X1 - X0 - gap * 2) / 3,
    h = (y1 - y0 - gap) / 2;
  list.forEach((name, i) => {
    const x = X0 + (i % 3) * (w + gap),
      y = y0 + Math.floor(i / 3) * (h + gap),
      hov = hovering(s, x, y, w, h);
    c.fillStyle = hov ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
    rrect(c, x, y, w, h, 12);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x + 14, y + h / 2);
    c.lineTo(x + 24, y + h / 2);
    c.moveTo(x + 19, y + h / 2 - 5);
    c.lineTo(x + 19, y + h / 2 + 5);
    c.stroke();
    textAt(c, name, x + 32, y + h / 2 + 0.5, { size: 12, max: w - 38 });
  });
}

/** proto: drawSettings */
export function drawSettings(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number): void {
  const rows: [string, boolean | null][] = [...s.prefs, ['Язык · Русский', null]],
    gap = 6,
    h = (y1 - y0 - gap * (rows.length - 1)) / rows.length;
  rows.forEach((r, i) => {
    const y = y0 + i * (h + gap),
      hov = r[1] !== null && hovering(s, X0, y, X1 - X0, h);
    c.fillStyle = hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
    rrect(c, X0, y, X1 - X0, h, 10);
    c.fill();
    textAt(c, r[0], X0 + 12, y + h / 2 + 0.5, { size: 12 });
    if (r[1] !== null) {
      const sx = X1 - 40,
        sy = y + h / 2 - 8;
      c.fillStyle = r[1] ? '#34C759' : 'rgba(255,255,255,0.2)';
      rrect(c, sx, sy, 30, 16, 8);
      c.fill();
      c.fillStyle = '#FFFFFF';
      c.beginPath();
      c.arc(r[1] ? sx + 22 : sx + 8, sy + 8, 6, 0, Math.PI * 2);
      c.fill();
      addHit(s, c, { x: X0, y, w: X1 - X0, h, act: 'pref:' + i });
    }
  });
}
