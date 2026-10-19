// Music in focus: the wide player and the narrow rail of the other modules (docs/SPEC.md 2.5).
import { hoverK } from './hover';
import { tr } from '../i18n';
import { clamp } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState } from '../sim/state';
import { propFor } from '../mascot/props';
import { TRACKS, TRACK_LEN } from '../stub';
import { addHit, hovering } from './hits';
import { T_MUTED } from './half';
import { card, cardMascot, cardTint } from './card';
import { slime, type ModuleItem } from './modules';
import { evRailA, evSlideK } from './eventIn';

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
    md = s.media,
    stub = TRACKS[s.trackIdx] as readonly [string, string],
    trk = md
      ? md.idle
        ? ([tr(s, md.title), tr(s, md.sub)] as const)
        : ([md.title, md.sub] as const)
      : ([tr(s, stub[0]), tr(s, stub[1])] as const),
    art = TRACK_ART[md ? md.artSeed % TRACK_ART.length : s.trackIdx] as readonly [string, string],
    len = md ? md.len : (TRACK_LEN[s.trackIdx] as number);
  c.save();
  rrect(c, ax, ay, as, as, 7);
  c.clip();
  if (md && (md.art || md.artPending)) {
    // a player's cover still loading after a track change: a quiet pulsing tile, never the
    // generated cover for a moment (players send the title first and the cover a bit later)
    if (!md.art || md.artA < 1) {
      c.fillStyle = 'rgba(255,255,255,' + (0.09 + 0.04 * Math.sin(t * 4)).toFixed(3) + ')';
      c.fillRect(ax, ay, as, as);
    }
    if (md.art) {
      // the player's own cover, cropped to a square, faded in over the tile
      const im = md.art as { width: number; height: number },
        side = Math.min(im.width, im.height);
      c.globalAlpha *= clamp(md.artA, 0, 1);
      c.drawImage(md.art, (im.width - side) / 2, (im.height - side) / 2, side, side, ax, ay, as, as);
    }
    c.restore();
  } else {
    // generated cover art: a gradient, a sun and two waves
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
  }
  const tx = ax + as + 10,
    right = X1 - 12;
  c.fillStyle = playing ? '#4FD27E' : '#8E8E93';
  c.beginPath();
  c.arc(tx + 3, ay + 11, 3, 0, Math.PI * 2);
  c.fill();
  textAt(c, trk[0], tx + 12, ay + 11.5, { size: 12.5, weight: 600, color: '#F5F6F8', max: right - tx - 12 });
  textAt(c, md ? trk[1] : trk[1] + ' · ' + (trk[0].split(' ')[0] as string), tx, ay + 29, {
    size: 11.5,
    weight: 400,
    color: T_MUTED,
    max: right - tx,
  });
  // progress with a seekable bar
  const py = ay + as + 13,
    bx0 = ax + 34,
    bx1 = right - 38,
    prog = len > 0 ? clamp(s.musicPos / len, 0, 1) : 0;
  textAt(c, mmss(s.musicPos), ax, py + 0.5, { size: 10.5, mono: true, color: T_MUTED });
  // a live stream has no length: no remaining time
  if (len > 0)
    textAt(c, '-' + mmss(len - s.musicPos), right, py + 0.5, {
      size: 10.5,
      mono: true,
      color: T_MUTED,
      align: 'right',
    });
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
  seqDt: number | null = null,
): void {
  // Grok Bot's rail (docs/CHANGES.md 2026-10-19): a narrow card, the modules as a stack of round
  // mascots in their colours, overlapping when they do not fit; hover pulls the name out to the left
  const t = s.t;
  const rw = rx1 - rx0,
    n = items.length,
    d = Math.min(rw - 12, 38),
    pad = 7,
    span = cy1 - cy0 - pad * 2 - d,
    // overlapping like a stack of coins, as Grok Bot's: the faces show, the rail stays compact
    step = n > 1 ? Math.min(d * 0.62, span / (n - 1)) : 0,
    top = cy0 + pad + d / 2 + (span - step * (n - 1)) / 2,
    cx = rx0 + rw / 2;
  c.save();
  if (seqDt !== null) c.globalAlpha *= evRailA(seqDt);
  card(c, rx0, cy0, rw, cy1 - cy0, false);
  c.restore();
  const rows = items.map((it, i) => {
    const y = top + i * step,
      st = s.railK[it.id] || (s.railK[it.id] = { k: 0, last: t });
    const hy0 = i === 0 ? cy0 : y - step / 2,
      hy1 = i === n - 1 ? cy1 : y + step / 2;
    const hov = hovering(s, rx0, hy0, rw, hy1 - hy0);
    st.k = hoverK(s, 'rail:' + it.id, hov);
    st.last = t;
    return { it, y, k: st.k, hy0, hy1 };
  });
  // bottom first: the upper one sits in front, as in a stack; only a mascot visibly lifted by the
  // hover comes to the front. Sorting every row by k let a spring settling around 0 (-0.03, +4e-4,
  // -2e-6...) flip a mascot from under all the others to over them frame after frame
  const lifted = (r: (typeof rows)[number]) => r.k > 0.02;
  const order = [...[...rows].reverse().filter((r) => !lifted(r)), ...rows.filter(lifted).sort((a, b) => a.k - b.k)];
  for (const { it, y, k } of order) {
    const i = items.indexOf(it);
    slime(s, c, it, cx, y, d * (1 + 0.1 * k), k, seqDt === null ? 1 : evSlideK(seqDt, i), i * 0.04);
  }
  for (const { it, y, k, hy0, hy1 } of rows) {
    if (k > 0.05) {
      c.save();
      c.globalAlpha *= Math.min(1, k);
      c.font = '500 12px Onest, system-ui, sans-serif';
      const w = c.measureText(it.name).width + 20,
        x = rx0 - 6 - w * (0.85 + 0.15 * k);
      c.fillStyle = 'rgba(40,40,44,0.97)';
      rrect(c, x, y - 12, w, 24, 12);
      c.fill();
      textAt(c, it.name, x + 10, y + 0.5, { size: 12 });
      c.restore();
    }
    addHit(s, c, { x: rx0, y: hy0, w: rw, h: hy1 - hy0, act: 'focus:' + it.id });
  }
}
