// Music in focus: the wide player and the narrow rail of the other modules (docs/SPEC.md 2.5).
import { clamp, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState } from '../sim/state';
import { propFor } from '../mascot/props';
import { TRACKS, TRACK_LEN } from '../stub';
import { addHit, hovering } from './hits';
import { T_MUTED } from './half';
import { card, cardMascot, cardTint } from './card';
import { drawGlyph, isHot, type ModuleItem } from './modules';

/** proto: TRACK_ART - gradient pairs of the generated covers */
export const TRACK_ART: readonly (readonly [string, string])[] = [
  ['#F28C6B', '#6B4FD8'],
  ['#2E3A6E', '#E3B04B'],
  ['#FF4FA3', '#2BD3E0'],
];

/** proto: mmss */
export const mmss = (sec: number): string => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

/** proto: iconBtn */
export function iconBtn(
  s: IslandState,
  c: Ctx,
  x: number,
  y: number,
  r: number,
  act: string,
  draw: (x: number, y: number) => void,
  on?: boolean,
): void {
  const hov = hovering(s, x - r, y - r, r * 2, r * 2);
  if (hov) {
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  c.save();
  c.fillStyle = c.strokeStyle = on === true ? '#4FD27E' : '#FFFFFF';
  c.lineWidth = 1.6;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  draw(x, y);
  c.restore();
  addHit(s, c, { x: x - r, y: y - r, w: r * 2, h: r * 2, act });
}

/** proto: drawMusicWide - a full player when music is in focus */
export function drawMusicWide(s: IslandState, c: Ctx, X0: number, X1: number, cy0: number, cy1: number): void {
  const t = s.t,
    playing = s.musicPlaying;
  const W = X1 - X0,
    H = cy1 - cy0;
  card(c, X0, cy0, W, H, false);
  cardTint(c, X0, cy0, W, H, '#9EE6B8', playing ? 0.2 : 0.08);
  cardMascot(s, c, X0, cy0, cy1, 'music', null, propFor(s, 'music'));
  const ax = X0 + 84,
    ay = cy0 + 10,
    as = 40,
    tr = TRACKS[s.trackIdx] as readonly [string, string],
    art = TRACK_ART[s.trackIdx] as readonly [string, string],
    len = TRACK_LEN[s.trackIdx] as number;
  // generated cover art: a gradient, a sun and two waves
  c.save();
  rrect(c, ax, ay, as, as, 7);
  c.clip();
  const g = c.createLinearGradient(ax, ay, ax + as, ay + as);
  g.addColorStop(0, art[0]);
  g.addColorStop(1, art[1]);
  c.fillStyle = g;
  c.fillRect(ax, ay, as, as);
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.beginPath();
  c.arc(ax + as * 0.68, ay + as * 0.34, as * 0.13, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.55)';
  c.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    c.beginPath();
    for (let k = 0; k <= 10; k++) {
      const x = ax + (k * as) / 10,
        y = ay + as * (0.66 + i * 0.14) + Math.sin(k * 1.1 + t * (playing ? 2 : 0) + i) * 2;
      if (k) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.stroke();
  }
  c.restore();
  const tx = ax + as + 10,
    right = X1 - 12;
  c.fillStyle = playing ? '#4FD27E' : '#8E8E93';
  c.beginPath();
  c.arc(tx + 3, ay + 11, 3, 0, Math.PI * 2);
  c.fill();
  textAt(c, tr[0], tx + 12, ay + 11.5, { size: 13, weight: 600, max: right - tx - 12 });
  textAt(c, tr[1] + ' · ' + (tr[0].split(' ')[0] as string), tx, ay + 29, {
    size: 11.5,
    weight: 400,
    color: T_MUTED,
    max: right - tx,
  });
  // progress with a seekable bar
  const py = ay + as + 13,
    bx0 = ax + 34,
    bx1 = right - 38,
    prog = clamp(s.musicPos / len, 0, 1);
  textAt(c, mmss(s.musicPos), ax, py + 0.5, { size: 10.5, mono: true, color: T_MUTED });
  textAt(c, '-' + mmss(len - s.musicPos), right, py + 0.5, { size: 10.5, mono: true, color: T_MUTED, align: 'right' });
  const hovBar = hovering(s, bx0, py - 6, bx1 - bx0, 12);
  c.fillStyle = 'rgba(255,255,255,0.18)';
  rrect(c, bx0, py - 2, bx1 - bx0, 4, 2);
  c.fill();
  c.fillStyle = '#FFFFFF';
  rrect(c, bx0, py - 2, (bx1 - bx0) * prog, 4, 2);
  c.fill();
  if (hovBar) {
    c.beginPath();
    c.arc(bx0 + (bx1 - bx0) * prog, py, 5, 0, Math.PI * 2);
    c.fill();
  }
  addHit(s, c, { x: bx0, y: py - 6, w: bx1 - bx0, h: 12, act: 'm:seek', bx0, bx1 });
  // controls: shuffle, previous, play, next, repeat, then volume
  const cyb = cy1 - 15;
  let x = ax + 8;
  iconBtn(
    s,
    c,
    x,
    cyb,
    10,
    'm:shuffle',
    (x, y) => {
      c.beginPath();
      c.moveTo(x - 6, y - 4);
      c.lineTo(x - 2, y - 4);
      c.lineTo(x + 3, y + 4);
      c.lineTo(x + 6, y + 4);
      c.moveTo(x - 6, y + 4);
      c.lineTo(x - 2, y + 4);
      c.lineTo(x + 3, y - 4);
      c.lineTo(x + 6, y - 4);
      c.stroke();
    },
    s.shuffle,
  );
  x += 28;
  iconBtn(s, c, x, cyb, 11, 'm:prev', (x, y) => {
    for (const o of [0, 6]) {
      c.beginPath();
      c.moveTo(x + 2 - o, y - 5);
      c.lineTo(x - 5 - o + 1, y);
      c.lineTo(x + 2 - o, y + 5);
      c.closePath();
      c.fill();
    }
  });
  x += 30;
  const hovP = hovering(s, x - 13, cyb - 13, 26, 26);
  c.fillStyle = hovP ? '#E6E6E6' : '#FFFFFF';
  c.beginPath();
  c.arc(x, cyb, 13, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#000';
  if (playing) {
    c.fillRect(x - 4.5, cyb - 5, 3, 10);
    c.fillRect(x + 1.5, cyb - 5, 3, 10);
  } else {
    c.beginPath();
    c.moveTo(x - 3.5, cyb - 6);
    c.lineTo(x + 6, cyb);
    c.lineTo(x - 3.5, cyb + 6);
    c.closePath();
    c.fill();
  }
  addHit(s, c, { x: x - 13, y: cyb - 13, w: 26, h: 26, act: 'm:toggle' });
  x += 30;
  iconBtn(s, c, x, cyb, 11, 'm:next', (x, y) => {
    for (const o of [0, 6]) {
      c.beginPath();
      c.moveTo(x - 2 + o - 4, y - 5);
      c.lineTo(x + 5 + o - 5, y);
      c.lineTo(x - 2 + o - 4, y + 5);
      c.closePath();
      c.fill();
    }
  });
  x += 28;
  iconBtn(
    s,
    c,
    x,
    cyb,
    10,
    'm:repeat',
    (x, y) => {
      c.beginPath();
      c.moveTo(x - 6, y + 1);
      c.lineTo(x - 6, y - 3);
      c.lineTo(x + 5, y - 3);
      c.moveTo(x + 3, y - 5.5);
      c.lineTo(x + 5.5, y - 3);
      c.lineTo(x + 3, y - 0.5);
      c.moveTo(x + 6, y - 1);
      c.lineTo(x + 6, y + 3);
      c.lineTo(x - 5, y + 3);
      c.moveTo(x - 3, y + 0.5);
      c.lineTo(x - 5.5, y + 3);
      c.lineTo(x - 3, y + 5.5);
      c.stroke();
    },
    s.repeat,
  );
  const vx0 = right - 62,
    vx1 = right;
  c.save();
  c.fillStyle = c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(vx0 - 16, cyb - 2);
  c.lineTo(vx0 - 13, cyb - 2);
  c.lineTo(vx0 - 9, cyb - 5);
  c.lineTo(vx0 - 9, cyb + 5);
  c.lineTo(vx0 - 13, cyb + 2);
  c.lineTo(vx0 - 16, cyb + 2);
  c.closePath();
  c.fill();
  c.beginPath();
  c.arc(vx0 - 8, cyb, 4, -0.8, 0.8);
  c.stroke();
  c.restore();
  c.fillStyle = 'rgba(255,255,255,0.18)';
  rrect(c, vx0, cyb - 2, vx1 - vx0, 4, 2);
  c.fill();
  c.fillStyle = '#FFFFFF';
  rrect(c, vx0, cyb - 2, (vx1 - vx0) * s.volume, 4, 2);
  c.fill();
  addHit(s, c, { x: vx0, y: cyb - 7, w: vx1 - vx0, h: 14, act: 'm:vol', bx0: vx0, bx1: vx1 });
}

/** proto: drawRail - a narrow rail of the other modules; hovering an icon slides out its name to the left */
export function drawRail(
  s: IslandState,
  c: Ctx,
  rx0: number,
  rx1: number,
  cy0: number,
  cy1: number,
  items: ModuleItem[],
): void {
  const t = s.t;
  const n = items.length,
    gap = 6,
    h = (cy1 - cy0 - gap * (n - 1)) / n,
    rw = rx1 - rx0;
  items.forEach((it, i) => {
    const y = cy0 + i * (h + gap),
      st = s.railK[it.id] || (s.railK[it.id] = { k: 0, last: t });
    c.save();
    c.font = '500 12px Onest, system-ui, sans-serif';
    const ext = c.measureText(it.name).width + 16;
    c.restore();
    const wNow = rw + ext * st.k;
    const hov = hovering(s, rx1 - Math.max(rw, wNow), y, Math.max(rw, wNow), h);
    st.k += ((hov ? 1 : 0) - st.k) * Math.min(1, (t - st.last) * 16);
    st.last = t;
    const k = ss(0, 1, st.k),
      w = rw + ext * k,
      x = rx1 - w;
    c.fillStyle = k > 0.02 ? 'rgba(48,48,52,0.97)' : isHot(it) ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.05)';
    rrect(c, x, y, w, h, 9);
    c.fill();
    if (k > 0.02) {
      c.fillStyle = 'rgba(255,255,255,' + (0.08 * k).toFixed(3) + ')';
      rrect(c, x, y, w, h, 9);
      c.fill();
    }
    drawGlyph(s, c, it, rx1 - rw / 2, y + h / 2, it.kind === 'agent' ? 7 : 6.5);
    if (k > 0.05) {
      c.save();
      c.beginPath();
      c.rect(x, y, w - rw + 2, h);
      c.clip();
      c.globalAlpha *= k;
      textAt(c, it.name, x + 10, y + h / 2 + 0.5, { size: 12 });
      c.restore();
    }
    addHit(s, c, { x, y, w, h, act: 'focus:' + it.id });
  });
}
