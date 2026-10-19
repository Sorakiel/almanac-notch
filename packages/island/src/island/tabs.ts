// The non-home tabs of the open island: chat, add a module, settings (docs/SPEC.md 2.6).
import { tr } from '../i18n';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { HostPrefs, IslandState } from '../sim/state';
import { addHit, hovering } from './hits';
import { T_MUTED } from './half';
import { card, cardMascot } from './card';
import { inLayer, layer, shared } from './reveal';

/** proto: drawChat */
export function drawChat(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number): void {
  const lw = 112;
  inLayer(s, c, 0, () => {
    if (!shared.card) card(c, X0, y0, lw, y1 - y0, false);
    cardMascot(s, c, X0 + 14, y0, y1, null, null);
  });
  const cx0 = X0 + lw + 8;
  inLayer(s, c, 1, () => {
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, cx0, y0 + 6, Math.min(220, X1 - cx0), 26, 13);
    c.fill();
    textAt(c, tr(s, 'Привет! Чем помочь?'), cx0 + 12, y0 + 19.5, { size: 12, weight: 400, max: X1 - cx0 - 24 });
  });
  inLayer(s, c, 2, () =>
    textAt(c, tr(s, 'qwen3.5:4b · локально'), X1 - 6, y1 - 42, {
      size: 11,
      weight: 400,
      color: T_MUTED,
      align: 'right',
    }),
  );
  c.save();
  layer(s, c, 3);
  c.fillStyle = 'rgba(255,255,255,0.08)';
  rrect(c, cx0, y1 - 32, X1 - cx0, 32, 16);
  c.fill();
  textAt(c, tr(s, 'Спроси что-нибудь…'), cx0 + 14, y1 - 15.5, {
    size: 12,
    weight: 400,
    color: 'rgba(255,255,255,0.4)',
  });
  c.fillStyle = 'rgba(255,255,255,0.86)';
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
  c.restore();
}

/** proto: drawAdd */
export function drawAdd(s: IslandState, c: Ctx, X0: number, X1: number, y0: number, y1: number): void {
  const list = [tr(s, 'Почта'), 'Notion', 'Obsidian', 'n8n', 'Vercel', 'Grafana'];
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
  if (s.host) return drawHostSettings(s, c, X0, X1, y0, y1, s.host);
  // in the app: a row that opens the settings window with every module (not in the prototype, docs/CHANGES.md)
  const rows: [string, boolean | null][] = [...s.prefs, ['Язык · Русский', null]];
  if (s.settingsLink) rows.push(['Все настройки', null]);
  const linkRow = s.settingsLink ? rows.length - 1 : -1,
    gap = 6,
    h = (y1 - y0 - gap * (rows.length - 1)) / rows.length;
  rows.forEach((r, i) => {
    c.save();
    layer(s, c, i);
    const y = y0 + i * (h + gap),
      hov = (r[1] !== null || i === linkRow) && hovering(s, X0, y, X1 - X0, h);
    c.fillStyle = hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
    rrect(c, X0, y, X1 - X0, h, 10);
    c.fill();
    textAt(c, tr(s, r[0]), X0 + 12, y + h / 2 + 0.5, { size: 12, max: X1 - X0 - 40 });
    if (i === linkRow) {
      textAt(c, '›', X1 - 18, y + h / 2 + 0.5, { size: 14, color: 'rgba(255,255,255,0.5)', align: 'center' });
      addHit(s, c, { x: X0, y, w: X1 - X0, h, act: 'open:settings' });
    }
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
    c.restore();
  });
}

const SEG_FONT = '500 11.5px Onest, system-ui, sans-serif';

/** A segmented control ending at `right`; the picked item is a lighter pill. */
function segment(
  s: IslandState,
  c: Ctx,
  right: number,
  y: number,
  items: [string, string][],
  cur: string,
  act: string,
): void {
  // 20 high: four rows share the card since the sound row (stage 9a)
  const H = 20,
    pad = 9;
  c.save();
  c.font = SEG_FONT;
  const widths = items.map(([label]) => c.measureText(tr(s, label)).width + pad * 2);
  c.restore();
  let x = right - widths.reduce((a, b) => a + b, 0) - 4;
  c.fillStyle = 'rgba(255,255,255,0.06)';
  rrect(c, x, y - H / 2 - 2, right - x, H + 4, (H + 4) / 2);
  c.fill();
  x += 2;
  items.forEach(([label, value], i) => {
    const w = widths[i] as number,
      on = value === cur,
      hov = !on && hovering(s, x, y - H / 2, w, H);
    if (on || hov) {
      c.fillStyle = on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
      rrect(c, x, y - H / 2, w, H, H / 2);
      c.fill();
    }
    textAt(c, tr(s, label), x + w / 2, y + 0.5, {
      size: 11.5,
      align: 'center',
      color: on ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)',
    });
    if (!on) addHit(s, c, { x, y: y - H / 2, w, h: H, act: act + ':' + value });
    x += w;
  });
}

/** A text button (a pill shows on hover), ending at `right`; returns its left edge. */
function linkButton(s: IslandState, c: Ctx, right: number, y: number, label: string, act: string): number {
  c.save();
  c.font = SEG_FONT;
  const w = c.measureText(tr(s, label)).width + 18;
  c.restore();
  const x = right - w,
    hov = hovering(s, x, y - 11, w, 22);
  if (hov) {
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, x, y - 11, w, 22, 11);
    c.fill();
  }
  textAt(c, tr(s, label), x + w / 2, y + 0.5, {
    size: 11.5,
    align: 'center',
    color: hov ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)',
  });
  addHit(s, c, { x, y: y - 11, w, h: 22, act });
  return x;
}

/** A small toggle like the prototype's settings rows, its right edge at `right`. */
function toggle(c: Ctx, right: number, y: number, on: boolean): void {
  const sx = right - 30,
    sy = y - 8;
  c.fillStyle = on ? '#34C759' : 'rgba(255,255,255,0.2)';
  rrect(c, sx, sy, 30, 16, 8);
  c.fill();
  c.fillStyle = '#FFFFFF';
  c.beginPath();
  c.arc(on ? sx + 22 : sx + 8, sy + 8, 6, 0, Math.PI * 2);
  c.fill();
}

const DOT: Readonly<Record<'ok' | 'bad' | 'off', string>> = {
  ok: '#34C759',
  bad: '#FF453A',
  off: 'rgba(255,255,255,0.28)',
};

/** A volume slider from x0 to x1: a thin track, the level in white, a knob; pale when off. */
function slider(s: IslandState, c: Ctx, x0: number, x1: number, y: number, v: number, on: boolean): void {
  const kx = x0 + (x1 - x0) * v;
  c.save();
  c.globalAlpha *= on ? 1 : 0.4; // multiply: the slider fades with its tab
  c.fillStyle = 'rgba(255,255,255,0.18)';
  rrect(c, x0, y - 2, x1 - x0, 4, 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  rrect(c, x0, y - 2, kx - x0, 4, 2);
  c.fill();
  c.fillStyle = '#FFFFFF';
  c.beginPath();
  c.arc(kx, y, hovering(s, x0 - 6, y - 10, x1 - x0 + 12, 20) || s.host?.volDrag ? 6.5 : 5.5, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // the zone reaches past the ends so 0 and 100 % are easy to hit
  addHit(s, c, { x: x0 - 6, y: y - 10, w: x1 - x0 + 12, h: 20, act: 'host:vol', bx0: x0, bx1: x1 });
}

/** The app's settings card (stage 8g, docs/CHANGES.md), after coucou's: the mascot, the sound row
 *  (switch, volume - stage 9a), auto-close, open on hover, the connection dots, "Settings…" and
 *  "Quit". Every control is real; the prototype's dummy switches are gone. */
function drawHostSettings(
  s: IslandState,
  c: Ctx,
  X0: number,
  X1: number,
  y0: number,
  y1: number,
  host: HostPrefs,
): void {
  inLayer(s, c, 0, () => {
    if (!shared.card) card(c, X0, y0, X1 - X0, y1 - y0, false);
    cardMascot(s, c, X0, y0, y1, null, null);
  });
  const L = X0 + 92,
    R = X1 - 14,
    h = y1 - y0,
    r0 = y0 + h * 0.17,
    r1 = y0 + h * 0.39,
    r2 = y0 + h * 0.61,
    r3 = y0 + h * 0.83;
  // sound, as coucou's first row: the switch, the word, the volume; the switch is the speaker's
  // state in the top bar
  const on = !s.muted;
  c.save();
  layer(s, c, 1);
  toggle(c, L + 30, r0, on);
  c.save();
  c.font = '500 12.5px Onest, system-ui, sans-serif';
  const soundW = c.measureText(tr(s, 'Звук')).width;
  c.restore();
  textAt(c, tr(s, 'Звук'), L + 40, r0 + 0.5, { size: 12.5 });
  addHit(s, c, { x: L - 4, y: r0 - 10, w: 48 + soundW, h: 20, act: 'host:sound' });
  slider(s, c, L + 40 + soundW + 18, R - 6, r0, host.volume, on);
  c.restore();
  c.save();
  layer(s, c, 2);
  // auto-close: a clock, the delay, the choices
  c.save();
  c.strokeStyle = 'rgba(255,255,255,0.6)';
  c.lineWidth = 1.4;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(L + 7, r1, 6.5, 0, Math.PI * 2);
  c.moveTo(L + 7, r1);
  c.lineTo(L + 7, r1 - 3.6);
  c.moveTo(L + 7, r1);
  c.lineTo(L + 9.6, r1 + 1.6);
  c.stroke();
  c.restore();
  textAt(c, tr(s, 'Автозакрытие · {0} с', host.autoClose), L + 22, r1 + 0.5, { size: 12.5 });
  segment(
    s,
    c,
    R,
    r1,
    [
      ['10 с', '10'],
      ['15 с', '15'],
      ['30 с', '30'],
    ],
    String(host.autoClose),
    'host:close',
  );
  c.restore();
  c.save();
  layer(s, c, 3);
  // open on hover: the whole row toggles
  const hov = hovering(s, L - 6, r2 - 11, R - L + 12, 22);
  if (hov) {
    c.fillStyle = 'rgba(255,255,255,0.05)';
    rrect(c, L - 6, r2 - 11, R - L + 12, 22, 11);
    c.fill();
  }
  textAt(c, tr(s, 'Открывать при наведении'), L, r2 + 0.5, { size: 12.5 });
  toggle(c, R - 4, r2, host.openOnHover);
  addHit(s, c, { x: L - 6, y: r2 - 11, w: R - L + 12, h: 22, act: 'host:hover' });
  c.restore();
  c.save();
  layer(s, c, 4);
  // footer: links on the right, the connection dots as far as they fit on the left
  const quitX = linkButton(s, c, R, r3, 'Выйти', 'host:quit');
  const linksX = linkButton(s, c, quitX - 4, r3, 'Настройки…', 'open:settings');
  c.save();
  c.font = SEG_FONT;
  let x = L;
  for (const st of host.status) {
    const label = tr(s, st.name),
      w = 10 + c.measureText(label).width;
    if (x + w > linksX - 8) break;
    c.fillStyle = DOT[st.state];
    c.beginPath();
    c.arc(x + 3, r3, 3, 0, Math.PI * 2);
    c.fill();
    textAt(c, label, x + 10, r3 + 0.5, { size: 11.5, color: T_MUTED });
    x += w + 12;
  }
  c.restore();
  c.restore();
}
