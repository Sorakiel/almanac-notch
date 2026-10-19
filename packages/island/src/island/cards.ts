// Cards of the home tab: the focus card, approvals and questions, the overload alert, the launch warp.
import { plural, tr } from '../i18n';
import { clamp, hexA, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState, ModuleId } from '../sim/state';
import { EVENTS, limitText, statusOf, stepAt, stepFrac, stepIndex } from '../sim/events';
import { drawMascot } from '../mascot/body';
import { propFor } from '../mascot/props';
import { TRACKS, type ToolKind } from '../stub';
import type { WorkFx } from './fx';
import { addHit, hovering } from './hits';
import { T_MUTED } from './half';
import { MODULE_COL, minsText } from './focus';
import { card, cardMascot, cardTint, kbdButton } from './card';
import { deployDot, modules, pageMark, prIcon, type ModuleItem } from './modules';

/** the muted word after the name in coucou's card head */
const HEAD_WORD: Partial<Record<ModuleId, string>> = {
  vercel: 'Деплои',
  notion: 'Недавние',
  grafana: 'Алерты',
  claude: 'агент',
  cal: 'сегодня',
  music: 'сейчас играет',
  almanac: 'привычки',
};

// One text system for every module card (2026-10-19), coucou's: three tones and two sizes. The
// name is ink, values are a soft light grey, labels and meta are dim; colour only marks a state
// (an icon, a dot, a late meeting), never a whole line.
const INK = '#F5F6F8',
  VAL = '#C5C8CD',
  DIM = '#8E939C',
  DIM3 = '#6B7079';
/** first content row and the step between rows, under the head */
const ROW0 = 42,
  ROW_STEP = 21;

/** a habit as a list row: the checkbox where the dot is, the name, its progress on the right;
 * the plate lights up under the pointer since the row is a button */
function habitRow(
  s: IslandState,
  c: Ctx,
  name: string,
  done: boolean,
  progress: string,
  act: string,
  tx: number,
  y: number,
  tmax: number,
): void {
  const hov = hovering(s, tx - 6, y - 10, tmax + 6, 20);
  c.fillStyle = hov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
  rrect(c, tx - 6, y - 10, tmax + 6, 20, 6);
  c.fill();
  checkBox(c, tx, y, done);
  c.save();
  c.font = '400 11px Onest, system-ui, sans-serif';
  const pw = progress ? c.measureText(progress).width + 10 : 0;
  c.restore();
  textAt(c, name, tx + 16, y + 0.5, {
    size: 11.5,
    weight: 500,
    color: done ? DIM3 : hov ? INK : VAL,
    max: tmax - 16 - pw,
  });
  if (progress) textAt(c, progress, tx + tmax, y + 0.5, { size: 11, weight: 400, color: DIM3, align: 'right' });
  addHit(s, c, { x: tx - 6, y: y - 10, w: tmax + 6, h: 20, act });
}

/** a "label ... value" row with a small icon, as coucou's stats */
function statRow(
  c: Ctx,
  icon: (x: number, y: number) => void,
  label: string,
  value: string,
  tx: number,
  y: number,
  tmax: number,
  valueColor = VAL,
): void {
  // label and value stay together on a wide card (the event card is twice as wide as the home one)
  tmax = Math.min(tmax, 240);
  icon(tx + 6, y);
  c.save();
  c.font = '600 12px Onest, system-ui, sans-serif';
  const vw = c.measureText(value).width;
  c.restore();
  textAt(c, label, tx + 18, y + 0.5, { size: 11.5, weight: 400, color: DIM, max: Math.max(20, tmax - 30 - vw) });
  textAt(c, value, tx + tmax, y + 0.5, { size: 12, weight: 600, color: valueColor, align: 'right' });
}

/** a list row: a dot of its colour, the name, a quiet note on the right; the first one leads on a
 * faint wash of its colour, as coucou's lists */
function listRow(
  c: Ctx,
  accent: string,
  first: boolean,
  name: string,
  meta: string,
  tx: number,
  y: number,
  tmax: number,
  lead = '',
): void {
  // every row sits on a faint plate, the first on a wash of its colour (coucou's mail list)
  c.fillStyle = first ? hexA(accent, 0.08) : 'rgba(255,255,255,0.03)';
  rrect(c, tx - 6, y - 10, tmax + 6, 20, 6);
  c.fill();
  c.fillStyle = accent;
  c.beginPath();
  c.arc(tx + 3, y, 2.6, 0, Math.PI * 2);
  c.fill();
  let x = tx + 12;
  if (lead) {
    textAt(c, lead, x, y + 0.5, { size: 11, weight: 500, mono: true, color: '#C9956A' });
    c.save();
    c.font = '500 11px "JetBrains Mono", monospace';
    x += c.measureText(lead).width + 7;
    c.restore();
  }
  c.save();
  c.font = '400 11px Onest, system-ui, sans-serif';
  const mw = meta ? c.measureText(meta).width + 10 : 0;
  c.restore();
  textAt(c, name, x, y + 0.5, { size: 11.5, weight: 500, color: first ? VAL : DIM, max: tx + tmax - x - mw });
  if (meta) textAt(c, meta, tx + tmax, y + 0.5, { size: 11, weight: 400, color: DIM3, align: 'right' });
}

/** small row icons in one line style */
function rowIcon(c: Ctx, kind: 'review' | 'clock' | 'commits', x: number, y: number, col = DIM3): void {
  c.save();
  c.strokeStyle = col;
  c.lineWidth = 1.2;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (kind === 'review') {
    c.ellipse(x, y, 5.2, 3.4, 0, 0, Math.PI * 2);
    c.moveTo(x + 1.6, y);
    c.arc(x, y, 1.6, 0, Math.PI * 2);
  } else if (kind === 'clock') {
    c.arc(x, y, 4.8, 0, Math.PI * 2);
    c.moveTo(x, y - 2.6);
    c.lineTo(x, y);
    c.lineTo(x + 1.8, y + 1.2);
  } else {
    c.moveTo(x - 4.5, y);
    c.lineTo(x - 1.8, y);
    c.moveTo(x + 1.8, y);
    c.lineTo(x + 4.5, y);
    c.moveTo(x + 1.8, y);
    c.arc(x, y, 1.8, 0, Math.PI * 2);
  }
  c.stroke();
  c.restore();
}

/** a status disc: filled circle of the state's colour with a check, cross or dash */
function stateDisc(c: Ctx, x: number, y: number, st: 'ok' | 'fail' | 'run' | 'none'): void {
  const col = st === 'ok' ? '#22C55E' : st === 'fail' ? '#F4505E' : st === 'run' ? '#3D8BFF' : '#6B7079';
  c.save();
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, 5, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#0B0B0D';
  c.lineWidth = 1.4;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (st === 'ok') {
    c.moveTo(x - 2.2, y);
    c.lineTo(x - 0.6, y + 1.6);
    c.lineTo(x + 2.3, y - 1.6);
  } else if (st === 'fail') {
    c.moveTo(x - 1.8, y - 1.8);
    c.lineTo(x + 1.8, y + 1.8);
    c.moveTo(x + 1.8, y - 1.8);
    c.lineTo(x - 1.8, y + 1.8);
  } else {
    c.moveTo(x - 2, y);
    c.lineTo(x + 2, y);
  }
  c.stroke();
  c.restore();
}

/** proto: QUESTION */
export const QUESTION: readonly [string, readonly string[]] = [
  'Какой раннер тестов взять?',
  ['Vitest', 'Jest', 'Playwright'],
];

/** proto: TOOL_TAG */
export const TOOL_TAG: Readonly<Record<ToolKind, readonly [string, string]>> = {
  read: ['R', 'rgba(255,255,255,0.55)'],
  edit: ['E', '#5FD27D'],
  bash: ['$', '#F5B94A'],
  grep: ['/', '#5FD6F0'],
};

/** a tool as a line glyph in a rounded square - one family, as Grok Bot's step icons (2026-10-19):
 * terminal prompt, page lines, pencil, magnifier */
function toolIcon(c: Ctx, kind: ToolKind, x: number, y: number, col: string, z = 1): void {
  c.save();
  c.translate(x, y);
  c.scale(z, z);
  c.strokeStyle = col;
  c.lineWidth = 1.15;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  rrect(c, -5.5, -5.5, 11, 11, 2.6);
  c.stroke();
  c.beginPath();
  if (kind === 'bash') {
    c.moveTo(-3, -1.8);
    c.lineTo(-1.2, 0);
    c.lineTo(-3, 1.8);
    c.moveTo(0.2, 2.2);
    c.lineTo(2.8, 2.2);
  } else if (kind === 'read') {
    c.moveTo(-2.6, -2);
    c.lineTo(2.6, -2);
    c.moveTo(-2.6, 0.2);
    c.lineTo(2.6, 0.2);
    c.moveTo(-2.6, 2.4);
    c.lineTo(0.6, 2.4);
  } else if (kind === 'edit') {
    c.moveTo(-2.6, 2.6);
    c.lineTo(-2.2, 1);
    c.lineTo(1.6, -2.8);
    c.lineTo(2.8, -1.6);
    c.lineTo(-1, 2.2);
    c.closePath();
  } else {
    c.arc(-0.6, -0.6, 2.2, 0, Math.PI * 2);
    c.moveTo(1.1, 1.1);
    c.lineTo(2.8, 2.8);
  }
  c.stroke();
  c.restore();
}

function ruCount(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10,
    m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

/** the session so far, for the line under the current step: steps taken, files changed */
function sessionLine(s: IslandState, cur: number): string {
  // the demo cycles through its steps, so it counts the ones on screen and a few before
  const n = s.agent ? s.agent.steps.length : cur + 3,
    files = new Set<string>();
  for (let i = s.agent ? Math.max(0, cur - 60) : cur - 6; i <= cur; i++) {
    const st = stepAt(s, i);
    if (st && st[0] === 'edit') files.add(st[2]);
  }
  const f = files.size;
  if (s.lang === 'en') return `${n} ${plural(n, 'step', 'steps')} · ${f} ${plural(f, 'file', 'files')} changed`;
  return `${n} ${ruCount(n, 'шаг', 'шага', 'шагов')} · ${f} ${ruCount(f, 'файл изменён', 'файла изменено', 'файлов изменено')}`;
}

/** proto: drawSteps - Grok Bot's step list (2026-10-19): the previous step above, small and dim;
 * the current one in the middle, bigger, a little to the right, with a slow light sweeping over
 * it; under it the session so far (Claude Code's hooks only tell what was done, there is no "next
 * step" to show). A new step rises from below into the middle, the old one shrinks up and away */
export function drawSteps(s: IslandState, c: Ctx, tx: number, y0: number, tmax: number): void {
  const ev = s.event;
  if (!ev) return;
  const cur = stepIndex(s),
    frac = stepFrac(s),
    k = ss(0, 1, frac / 0.22);
  const Y_PREV = y0 + 44,
    Y_CUR = y0 + 68,
    Y_SUM = y0 + 92,
    S_PREV = 11.5,
    S_CUR = 14;
  const row = (
    st: NonNullable<ReturnType<typeof stepAt>>,
    y: number,
    size: number,
    a: number,
    dx: number,
    now: boolean,
  ) => {
    c.save();
    c.globalAlpha *= a;
    const z = size / S_CUR;
    toolIcon(c, st[0], tx + 6 + dx, y, 'rgba(255,255,255,0.75)', 0.82 + 0.3 * z);
    c.font = `${now ? 500 : 400} ${size}px Onest, system-ui, sans-serif`;
    const x = tx + 18 + dx * 1.6,
      label = st[1] + ' ' + st[2],
      diffW = now && st[3] ? 58 : 0;
    const max = Math.max(20, tmax - (x - tx) - diffW);
    if (now) {
      // the light sweep: a brighter band crossing the line every 2.4 s, as Grok Bot's working step
      const w = Math.min(max, c.measureText(label).width),
        ph = (s.t % 2.4) / 1.6,
        bx = x - 40 + (w + 80) * Math.min(1, ph);
      const g = c.createLinearGradient(bx - 40, 0, bx + 40, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.72)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0.72)');
      textAt(c, label, x, y + 0.5, { size, weight: 500, color: 'rgba(255,255,255,0.72)', max });
      if (ph < 1) {
        c.save();
        c.beginPath();
        c.rect(bx - 40, y - size, 80, size * 2);
        c.clip();
        c.fillStyle = g;
        c.textBaseline = 'middle';
        let t = label;
        if (c.measureText(t).width > max) {
          while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
          t = t.trimEnd() + '…';
        }
        c.fillText(t, x, y + 0.5);
        c.restore();
      }
      if (st[3]) {
        textAt(c, st[3], tx + tmax - 30, y + 0.5, { size: 12, weight: 500, color: '#5FD27D', align: 'right' });
        textAt(c, st[4] as string, tx + tmax, y + 0.5, { size: 12, weight: 500, color: '#FF6B61', align: 'right' });
      }
    } else textAt(c, label, x, y + 0.5, { size, weight: 400, color: 'rgba(255,255,255,0.8)', max });
    c.restore();
  };
  const prev2 = stepAt(s, cur - 2),
    prev = stepAt(s, cur - 1),
    now = stepAt(s, cur);
  // the one leaving: up and out
  if (prev2 && k < 1) row(prev2, Y_PREV - 18 * k, S_PREV, 0.45 * (1 - k), 0, false);
  // the previous: from the middle up to the top row, shrinking and dimming
  if (prev)
    row(
      prev,
      Y_CUR + (Y_PREV - Y_CUR) * k,
      S_CUR + (S_PREV - S_CUR) * k,
      0.92 + (0.45 - 0.92) * k,
      4 * (1 - k),
      k > 0.99 ? false : k < 0.5,
    );
  // the current: rises from below into the middle
  if (now) row(now, Y_CUR + 12 * (1 - k), S_PREV + (S_CUR - S_PREV) * k, k, 4 * k, true);
  // the summary steps back while the new step passes over it
  textAt(c, sessionLine(s, cur), tx + 18, Y_SUM + 0.5, {
    size: 11,
    weight: 400,
    color: 'rgba(255,255,255,0.38)',
    max: tmax - 18,
  });
}

/** "12 мин назад" - the value of the "last session" row */
function agoText(s: IslandState, at: number | null): string {
  if (at === null) return tr(s, 'не было');
  const min = Math.floor((s.date().getTime() - at) / 60000);
  if (min < 1) return tr(s, 'только что');
  if (min < 60) return tr(s, '{0} мин назад', min);
  const h = Math.floor(min / 60);
  return h < 24 ? tr(s, '{0} ч назад', h) : tr(s, 'давно');
}

/**
 * Not in the prototype (docs/CHANGES.md): coucou's card head - a dot in the module colour, the
 * name, a muted word ("Деплои", "Недавние", "Алерты"), an optional arrow (Vercel: the newest
 * deployment, Grafana: the alert list).
 */
function brandHead(
  s: IslandState,
  c: Ctx,
  id: ModuleId,
  name: string,
  tx: number,
  y0: number,
  x1: number,
  wordIn?: string,
  wordCol = DIM,
  badge?: string,
): void {
  c.fillStyle = MODULE_COL[id].body;
  c.beginPath();
  c.arc(tx + 3.5, y0 + 18, 3.5, 0, Math.PI * 2);
  c.fill();
  textAt(c, name, tx + 13, y0 + 18.5, { size: 12.5, weight: 600, color: INK });
  c.save();
  c.font = '600 12.5px Onest, system-ui, sans-serif';
  const nw = c.measureText(name).width;
  c.restore();
  const word = wordIn ?? tr(s, HEAD_WORD[id] ?? '');
  if (word)
    textAt(c, word, tx + 19 + nw, y0 + 18.5, { size: 11.5, weight: wordCol === DIM ? 400 : 500, color: wordCol });
  // a count in a pill of the module's colour after the word, as coucou's "3 unread"
  if (badge) {
    c.save();
    c.font = '400 11.5px Onest, system-ui, sans-serif';
    const ww = word ? c.measureText(word).width + 8 : 0;
    c.font = '500 11px Onest, system-ui, sans-serif';
    const bw = c.measureText(badge).width + 14;
    c.restore();
    const bx = tx + 19 + nw + ww,
      col = MODULE_COL[id].body;
    c.fillStyle = hexA(col, 0.16);
    rrect(c, bx, y0 + 10, bw, 17, 8.5);
    c.fill();
    textAt(c, badge, bx + bw / 2, y0 + 18.5, { size: 11, weight: 500, color: col, align: 'center' });
  }
  // GitHub: the week of commits as small cells after the name, as coucou's head
  if (id === 'github') {
    const CM = s.github ? s.github.commits : [4, 0, 6, 9, 3, 7, 5],
      mx = Math.max(1, ...CM);
    CM.forEach((v, i) => {
      c.fillStyle = !v ? 'rgba(255,255,255,0.08)' : hexA('#22C55E', 0.25 + 0.75 * (v / mx));
      rrect(c, tx + 21 + nw + i * 9, y0 + 14.5, 7, 7, 1.5);
      c.fill();
    });
  }
  const top = id === 'vercel' && s.vercel && s.vercel.auth === 'ok' ? s.vercel.rows[0] : undefined;
  const act = top
    ? 'vercel:' + top.id
    : id === 'grafana' && s.grafana && s.grafana.auth === 'ok'
      ? 'grafana:alerts'
      : '';
  if (!act) return;
  const bx = x1 - 20,
    by = y0 + 17,
    hov = hovering(s, bx - 11, by - 11, 22, 22);
  c.fillStyle = hov ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.09)';
  c.beginPath();
  c.arc(bx, by, 11, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = hov ? '#FFFFFF' : 'rgba(255,255,255,0.6)';
  c.lineWidth = 1.4;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(bx - 3.5, by + 3.5);
  c.lineTo(bx + 3.5, by - 3.5);
  c.moveTo(bx - 2, by - 3.5);
  c.lineTo(bx + 3.5, by - 3.5);
  c.lineTo(bx + 3.5, by + 2);
  c.stroke();
  addHit(s, c, { x: bx - 11, y: by - 11, w: 22, h: 22, act });
}

/** Cut a string to a width with "…" instead of squeezing it (textAt's max narrows the glyphs). */
/** proto: the habits card's checkbox (drawFocusCard) - pink filled with a tick when done */
function checkBox(c: Ctx, x: number, y: number, on: boolean): void {
  c.strokeStyle = on ? '#F4A9C6' : 'rgba(255,255,255,0.4)';
  c.fillStyle = '#F4A9C6';
  c.lineWidth = 1.4;
  rrect(c, x, y - 5, 10, 10, 3);
  if (on) c.fill();
  else c.stroke();
  if (on) {
    c.strokeStyle = '#16171A';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(x + 2.5, y);
    c.lineTo(x + 4.5, y + 2.2);
    c.lineTo(x + 7.8, y - 2.4);
    c.stroke();
  }
}

function fit(c: Ctx, str: string, font: string, max: number): string {
  c.save();
  c.font = font;
  let out = str;
  if (c.measureText(out).width > max) {
    while (out.length > 1 && c.measureText(out + '…').width > max) out = out.slice(0, -1);
    out = out.trimEnd() + '…';
  }
  c.restore();
  return out;
}

/** Not in the prototype (docs/CHANGES.md): a Grafana row's dot - red breathing, amber, green. */
function alertDot(c: Ctx, x: number, y: number, st: 'fail' | 'run' | 'ok', t: number): void {
  c.save();
  if (st === 'fail') c.globalAlpha *= 0.6 + 0.4 * Math.sin(t * 5);
  c.fillStyle = st === 'fail' ? '#FF453A' : st === 'run' ? '#F5A524' : '#34C759';
  c.beginPath();
  c.arc(x, y, 2.6, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/**
 * Not in the prototype (docs/CHANGES.md): the picked Grafana dashboard - its title, the panel's
 * last value and a small graph of its last hour; the block opens the dashboard.
 */
function boardBlock(
  s: IslandState,
  c: Ctx,
  b: NonNullable<NonNullable<IslandState['grafana']>['board']>,
  tx: number,
  y: number,
  tmax: number,
): void {
  const h = 36,
    hov = hovering(s, tx - 6, y, tmax + 6, h);
  c.fillStyle = hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
  rrect(c, tx - 6, y, tmax + 6, h, 8);
  c.fill();
  const gw = Math.min(110, tmax * 0.48),
    gx1 = tx + tmax - 6,
    gx0 = gx1 - gw;
  let lx = tx;
  if (b.firing) {
    alertDot(c, tx + 3, y + 10.5, 'fail', s.t);
    lx = tx + 11;
  }
  // the title takes the whole width; the graph sits under it, right of the value
  const title = fit(c, b.title, '400 10.5px Onest, system-ui, sans-serif', tx + tmax - 6 - lx);
  textAt(c, title, lx, y + 10.5, { size: 10.5, weight: 400, color: T_MUTED });
  textAt(c, b.value, tx, y + 25.5, { size: 14, weight: 600, color: 'rgba(255,255,255,0.92)', max: gx0 - tx - 6 });
  const pts = b.points;
  if (pts.length > 1) {
    const lo = Math.min(...pts),
      hi = Math.max(...pts);
    const gy0 = y + 18,
      gh = h - 22,
      span = hi - lo || 1,
      px = (i: number): number => gx0 + (i / (pts.length - 1)) * gw,
      py = (v: number): number => (hi === lo ? gy0 + gh / 2 : gy0 + gh - ((v - lo) / span) * gh);
    const col = b.firing ? '#FF6B61' : MODULE_COL.grafana.body;
    c.beginPath();
    pts.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))));
    c.save();
    c.lineTo(gx1, gy0 + gh);
    c.lineTo(gx0, gy0 + gh);
    c.closePath();
    const g = c.createLinearGradient(0, gy0, 0, gy0 + gh);
    g.addColorStop(0, b.firing ? 'rgba(255,107,97,0.28)' : 'rgba(255,140,102,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fill();
    c.restore();
    c.beginPath();
    pts.forEach((v, i) => (i ? c.lineTo(px(i), py(v)) : c.moveTo(px(i), py(v))));
    c.strokeStyle = col;
    c.lineWidth = 1.4;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();
    c.fillStyle = col;
    c.beginPath();
    c.arc(gx1, py(pts[pts.length - 1] as number), 2, 0, Math.PI * 2);
    c.fill();
  }
  addHit(s, c, { x: tx - 6, y, w: tmax + 6, h, act: 'grafana:board' });
}

/** proto: drawFocusCard - the large card of the module in focus */
export function drawFocusCard(
  s: IslandState,
  c: Ctx,
  f: ModuleId,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fx: WorkFx | null,
): void {
  const m = modules(s),
    it = m.find((i) => i.id === f) as ModuleItem;
  cardMascot(s, c, x0, y0, y1, f, f === 'claude' ? fx : null, propFor(s, f));
  const tx = x0 + 84,
    tmax = x1 - tx - 10;
  // one head for every card; the calendar's says how soon the next meeting is (amber when close)
  const calMins = it.kind === 'cal' ? (s.cal ? s.cal.mins : it.mins) : null;
  if (calMins !== null)
    brandHead(
      s,
      c,
      it.id,
      it.name,
      tx,
      y0,
      x1,
      calMins <= 0 ? tr(s, 'сейчас') : tr(s, 'через {0}', minsText(s, calMins)),
      calMins <= 5 ? '#F5B94A' : DIM,
    );
  else if (it.kind === 'habits')
    brandHead(s, c, it.id, it.name, tx, y0, x1, undefined, DIM, it.total ? `${it.done}/${it.total}` : undefined);
  else if (it.kind === 'music' && !s.musicPlaying) brandHead(s, c, it.id, it.name, tx, y0, x1, tr(s, 'на паузе'));
  else brandHead(s, c, it.id, it.name, tx, y0, x1);
  // one line leads (14 px, bright), the rest step back - as Grok Bot's card reads at a glance
  // plain lines (music, hints): the first one in the value tone, the rest dim - the same system
  const L = (i: number, str: string, color?: string, mono?: boolean): void =>
    textAt(c, str, tx, y0 + ROW0 + i * ROW_STEP, {
      size: mono ? 11 : i === 0 ? 12.5 : 11.5,
      weight: i === 0 ? 500 : 400,
      color: color || (i === 0 ? VAL : DIM),
      ...(mono ? { mono } : {}),
      max: tmax,
    });
  if (it.kind === 'agent') {
    if (it.state === 'work') drawSteps(s, c, tx, y0, tmax);
    else if (it.state === 'search') {
      listRow(c, '#5FD6F0', true, tr(s, 'ищет по проекту'), '', tx, y0 + ROW0, tmax);
      listRow(
        c,
        DIM3,
        false,
        s.agent ? s.agent.search : tr(s, 'grep "rrect(" · 14 совпадений'),
        '',
        tx,
        y0 + ROW0 + ROW_STEP,
        tmax,
      );
    } else if (it.state === 'limit') {
      listRow(c, '#C7C7CC', true, tr(s, 'лимит плана исчерпан'), '', tx, y0 + ROW0, tmax);
      statRow(c, (x, y) => rowIcon(c, 'clock', x, y), tr(s, 'Сброс'), limitText(s), tx, y0 + ROW0 + ROW_STEP, tmax);
      statRow(
        c,
        (x, y) => rowIcon(c, 'commits', x, y),
        tr(s, 'План'),
        s.agent ? s.agent.plan : 'Pro',
        tx,
        y0 + ROW0 + ROW_STEP * 2,
        tmax,
      );
    } else if (it.state === 'think') {
      listRow(c, '#BFA6FF', true, tr(s, s.agent ? 'думает' : 'планирует изменения'), '', tx, y0 + ROW0, tmax);
      listRow(
        c,
        DIM3,
        false,
        s.agent ? s.agent.think : tr(s, 'смотрит структуру проекта'),
        '',
        tx,
        y0 + ROW0 + ROW_STEP,
        tmax,
      );
    } else {
      statRow(c, (x, y) => stateDisc(c, x, y, 'ok'), tr(s, 'Статус'), tr(s, 'свободен'), tx, y0 + ROW0, tmax);
      statRow(
        c,
        (x, y) => rowIcon(c, 'clock', x, y),
        tr(s, 'Последняя сессия'),
        agoText(s, s.agent ? s.agent.lastActive : Date.now() - 12 * 60000),
        tx,
        y0 + ROW0 + ROW_STEP,
        tmax,
      );
    }
  } else if (it.kind === 'ci' && s.github && s.github.auth !== 'ok') {
    // live GitHub with nothing to show: say why and where to connect
    L(0, s.github.hint[0], 'rgba(255,255,255,0.92)');
    L(1, s.github.hint[1], T_MUTED);
  } else if (it.kind === 'ci') {
    // coucou's GitHub card: the numbers as rows, the colour only on the CI disc
    const gh = s.github,
      ci = gh ? gh.ci : it.state === 'off' ? 'none' : it.state;
    const repo = gh && gh.ciText.includes(' · ') ? gh.ciText.split(' · ')[0] : '';
    const ciWord =
      ci === 'ok'
        ? tr(s, 'зелёный')
        : ci === 'fail'
          ? tr(s, 'упал')
          : ci === 'run'
            ? tr(s, 'идёт')
            : tr(s, 'нет проверок');
    const prs = gh ? gh.prs : 2,
      week = (gh ? gh.commits : [4, 0, 6, 9, 3, 7, 5]).reduce((a, b) => a + b, 0);
    statRow(
      c,
      (x, y) => stateDisc(c, x, y, ci),
      repo ? tr(s, 'CI · {0}', repo) : tr(s, 'CI основной ветки'),
      ciWord,
      tx,
      y0 + ROW0,
      tmax,
      ci === 'fail' ? '#F4505E' : VAL,
    );
    statRow(c, (x, y) => prIcon(c, x, y), tr(s, 'Ждут ревью'), String(prs), tx, y0 + ROW0 + ROW_STEP, tmax);
    statRow(
      c,
      (x, y) => rowIcon(c, 'commits', x, y),
      tr(s, 'Коммиты за 7 дней'),
      String(week),
      tx,
      y0 + ROW0 + ROW_STEP * 2,
      tmax,
    );
  } else if (it.kind === 'deploy' && s.vercel) {
    // not in the prototype (docs/CHANGES.md): the newest deployments, as coucou's card
    const vc = s.vercel;
    if (vc.auth !== 'ok' || !vc.rows.length) {
      L(0, vc.hint[0], 'rgba(255,255,255,0.92)');
      if (vc.hint[1]) L(1, vc.hint[1], T_MUTED);
    } else
      vc.rows.forEach((r, i) => {
        const y = y0 + 40 + i * 18;
        if (i === 0) {
          c.fillStyle = 'rgba(255,255,255,0.06)';
          rrect(c, tx - 6, y - 9, tmax + 6, 18, 6);
          c.fill();
        }
        deployDot(c, tx + 3, y + 0.5, 2.6, r.state, s.t);
        c.save();
        c.font = '600 11.5px Onest, system-ui, sans-serif';
        const nw = Math.min(c.measureText(r.name).width, tmax - 60);
        c.restore();
        textAt(c, r.name, tx + 12, y + 0.5, {
          size: 11.5,
          weight: 600,
          color: i === 0 ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.75)',
          max: tmax - 60,
        });
        textAt(c, r.ago, tx + 18 + nw, y + 0.5, { size: 11, weight: 400, color: T_MUTED, max: tmax - 18 - nw });
      });
  } else if (it.kind === 'pages' && s.notion) {
    // not in the prototype (docs/CHANGES.md): the pages edited last, as coucou's card; a row opens the page
    const no = s.notion;
    if (no.auth !== 'ok' || !no.rows.length) {
      L(0, no.hint[0], 'rgba(255,255,255,0.92)');
      if (no.hint[1]) L(1, no.hint[1], T_MUTED);
    } else
      no.rows.forEach((r, i) => {
        const y = y0 + 40 + i * 18,
          hov = hovering(s, tx - 6, y - 9, tmax + 6, 18);
        if (hov || i === 0) {
          c.fillStyle = hov ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)';
          rrect(c, tx - 6, y - 9, tmax + 6, 18, 6);
          c.fill();
        }
        if (r.emoji) textAt(c, r.emoji, tx + 3, y + 0.5, { size: 10, weight: 400, align: 'center' });
        else pageMark(c, tx + 3, y + 0.5, 3.6, 'rgba(255,255,255,0.55)');
        c.save();
        c.font = '600 11.5px Onest, system-ui, sans-serif';
        const nw = Math.min(c.measureText(r.title).width, tmax - 60);
        c.restore();
        textAt(c, r.title, tx + 12, y + 0.5, {
          size: 11.5,
          weight: 600,
          color: i === 0 || hov ? '#FFFFFF' : 'rgba(255,255,255,0.75)',
          max: tmax - 60,
        });
        textAt(c, r.ago, tx + 18 + nw, y + 0.5, { size: 11, weight: 400, color: T_MUTED, max: tmax - 18 - nw });
        addHit(s, c, { x: tx - 6, y: y - 9, w: tmax + 6, h: 18, act: 'notion:' + r.id });
      });
  } else if (it.kind === 'alerts' && s.grafana) {
    // not in the prototype (docs/CHANGES.md): the alert rules firing (red) or pending (amber),
    // then the dashboard picked in settings with one panel's last hour
    const gf = s.grafana,
      n = gf.board ? 1 : 3;
    const row = (i: number, dot: 'fail' | 'run' | 'ok', name: string, ago: string): void => {
      const y = y0 + 40 + i * 18;
      if (i === 0 && dot !== 'ok') {
        c.fillStyle = dot === 'fail' ? 'rgba(255,69,58,0.14)' : 'rgba(255,255,255,0.06)';
        rrect(c, tx - 6, y - 9, tmax + 6, 18, 6);
        c.fill();
      }
      alertDot(c, tx + 3, y + 0.5, dot, s.t);
      c.save();
      c.font = '400 11px Onest, system-ui, sans-serif';
      const aw = c.measureText(ago).width;
      c.font = '600 11.5px Onest, system-ui, sans-serif';
      // the name keeps at least 60% of the row; the age gives way first
      const label = fit(c, name, c.font, Math.max(tmax * 0.6, tmax - 18 - aw)),
        nw = c.measureText(label).width;
      c.restore();
      const when = fit(c, ago, '400 11px Onest, system-ui, sans-serif', tmax - 18 - nw);
      textAt(c, label, tx + 12, y + 0.5, {
        size: 11.5,
        weight: 600,
        color: dot === 'run' ? 'rgba(255,255,255,0.75)' : '#FFFFFF',
      });
      textAt(c, when, tx + 18 + nw, y + 0.5, { size: 11, weight: 400, color: T_MUTED });
    };
    if (gf.auth !== 'ok') {
      L(0, gf.hint[0], 'rgba(255,255,255,0.92)');
      if (gf.hint[1]) L(1, gf.hint[1], T_MUTED);
    } else {
      if (gf.rows.length)
        gf.rows.slice(0, n).forEach((r, i) => {
          const more = i === n - 1 && gf.total > n ? '+' + (gf.total - n) : '';
          row(i, r.state, r.name, r.ago && more ? r.ago + ' · ' + more : r.ago || more);
        });
      else if (gf.state === 'ok') {
        row(0, 'ok', gf.hint[0], '');
        if (!gf.board) L(1, gf.hint[1], T_MUTED);
      } else {
        L(0, gf.hint[0], 'rgba(255,255,255,0.92)');
        if (!gf.board && gf.hint[1]) L(1, gf.hint[1], T_MUTED);
      }
      if (gf.board) boardBlock(s, c, gf.board, tx, y0 + 51, tmax);
    }
  } else if (it.kind === 'cal' && s.cal) {
    const cal = s.cal;
    if (cal.mins === null) {
      listRow(c, MODULE_COL.cal.body, true, cal.title, '', tx, y0 + ROW0, tmax);
      if (cal.after) listRow(c, DIM3, false, cal.after, '', tx, y0 + ROW0 + ROW_STEP, tmax);
    } else {
      // the next meeting leads, its time in the warm mono of coucou's lists (how soon is in the head)
      const soon = cal.mins <= 5;
      listRow(c, soon ? '#F5B94A' : MODULE_COL.cal.body, true, cal.title, '', tx, y0 + ROW0, tmax, cal.at);
      if (cal.after) listRow(c, DIM3, false, cal.after, '', tx, y0 + ROW0 + ROW_STEP, tmax);
    }
  } else if (it.kind === 'cal') {
    listRow(
      c,
      it.mins <= 5 ? '#F5B94A' : MODULE_COL.cal.body,
      true,
      tr(s, 'Созвон с командой'),
      '',
      tx,
      y0 + ROW0,
      tmax,
      '15:00',
    );
    listRow(c, DIM3, false, tr(s, 'Лекция'), '', tx, y0 + ROW0 + ROW_STEP, tmax, '17:10');
  } else if (it.kind === 'music') {
    const trk = s.media ? ([s.media.title, s.media.sub] as const) : (TRACKS[s.trackIdx] as readonly [string, string]);
    // live track names pass through; the stub and the "nothing playing" lines are keys
    L(0, s.media && !s.media.idle ? trk[0] : tr(s, trk[0]));
    L(1, s.media && !s.media.idle ? trk[1] : tr(s, trk[1]));
    const by = y1 - 16,
      cx = tx + tmax / 2;
    const ctrl = (x: number, act: string, draw: (x: number) => void): void => {
      const hov = hovering(s, x - 12, by - 11, 24, 22);
      if (hov) {
        c.fillStyle = 'rgba(255,255,255,0.1)';
        c.beginPath();
        c.arc(x, by, 11, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = hov ? INK : VAL;
      draw(x);
      addHit(s, c, { x: x - 12, y: by - 11, w: 24, h: 22, act });
    };
    ctrl(cx - 32, 'm:prev', (x) => {
      c.beginPath();
      c.moveTo(x + 4, by - 5);
      c.lineTo(x - 3, by);
      c.lineTo(x + 4, by + 5);
      c.closePath();
      c.fill();
      c.fillRect(x - 5, by - 5, 2, 10);
    });
    ctrl(cx, 'm:toggle', (x) => {
      if (s.musicPlaying) {
        c.fillRect(x - 5, by - 6, 3.5, 12);
        c.fillRect(x + 1.5, by - 6, 3.5, 12);
      } else {
        c.beginPath();
        c.moveTo(x - 4, by - 6);
        c.lineTo(x + 6, by);
        c.lineTo(x - 4, by + 6);
        c.closePath();
        c.fill();
      }
    });
    ctrl(cx + 32, 'm:next', (x) => {
      c.beginPath();
      c.moveTo(x - 4, by - 5);
      c.lineTo(x + 3, by);
      c.lineTo(x - 4, by + 5);
      c.closePath();
      c.fill();
      c.fillRect(x + 3, by - 5, 2, 10);
    });
  } else if (s.almanac) {
    // not in the prototype (docs/CHANGES.md): today's habits from Almanac, the open ones first;
    // a row marks the habit in Almanac (one tap more for "8 glasses"), like the stub's checkbox
    const al = s.almanac;
    if (al.auth !== 'ok' || !al.rows.length) {
      L(0, al.hint[0], 'rgba(255,255,255,0.92)');
      if (al.hint[1]) L(1, al.hint[1], T_MUTED);
    } else
      al.rows
        .slice(0, 3)
        .forEach((h, i) =>
          habitRow(s, c, h.name, h.done, h.progress ?? '', 'almanac:' + h.id, tx, y0 + ROW0 + i * ROW_STEP, tmax),
        );
  } else {
    s.habits
      .slice(0, 3)
      .forEach((h, i) => habitRow(s, c, tr(s, h[0]), h[1], '', 'habit:' + i, tx, y0 + ROW0 + i * ROW_STEP, tmax));
  }
}

/** proto: drawAsk - approvals and questions: one wide card tinted with the state colour, keyboard answers */
export function drawAsk(
  s: IslandState,
  c: Ctx,
  X0: number,
  X1: number,
  cy0: number,
  cy1: number,
  fx: WorkFx | null,
): void {
  const ev = s.event;
  if (!ev) return;
  const t = s.t;
  const q = ev.type === 'question',
    el = t - ev.start,
    E = EVENTS[ev.type];
  const k = ss(0, 1, el / 0.35);
  let dx = 0;
  if (ev.answer === 'deny') {
    const a = t - (ev.answerAt ?? 0);
    dx = Math.sin(a * 42) * 4 * Math.exp(-a * 6);
  }
  c.save();
  c.translate(dx, (1 - k) * -6);
  c.globalAlpha *= k;
  const W = X1 - X0,
    H = cy1 - cy0;
  card(c, X0, cy0, W, H, false);
  cardTint(c, X0, cy0, W, H, ev.answer === 'approve' ? '#34C759' : E.color, 0.42);
  cardMascot(s, c, X0, cy0, cy1, 'claude', fx);
  // the text block sits in the middle of a card taller than the prototype's (2026-10-19); the
  // timer line stays on the bottom edge
  const top = cy0 + Math.max(0, (H - 100) / 2);
  const tx = X0 + 88,
    tw = X1 - tx - 14;
  c.fillStyle = E.color;
  c.beginPath();
  c.arc(tx + 3, top + 17, 3, 0, Math.PI * 2);
  c.fill();
  textAt(c, 'Claude Code', tx + 12, top + 17.5, { size: 12.5, weight: 600 });
  c.save();
  c.font = '600 12.5px Onest, system-ui, sans-serif';
  const nw = c.measureText('Claude Code').width;
  c.restore();
  textAt(c, tr(s, q ? 'спрашивает' : 'нужно разрешение'), tx + 18 + nw, top + 17.5, {
    size: 12,
    weight: 400,
    color: T_MUTED,
  });
  if (!q) {
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, tx, top + 28, tw, 26, 8);
    c.fill();
    const cmd = s.agent ? s.agent.cmd : 'git push origin main',
      n = clamp(Math.floor((el - 0.25) * 40), 0, cmd.length);
    textAt(c, cmd.slice(0, n), tx + 10, top + 41.5, {
      mono: true,
      size: 11.5,
      color: 'rgba(255,255,255,0.9)',
      max: tw - 20,
    });
    if (n < cmd.length || Math.floor(t * 2) % 2) {
      c.save();
      c.font = '400 11.5px "JetBrains Mono", monospace';
      const cw = c.measureText(cmd.slice(0, n)).width;
      c.restore();
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.fillRect(tx + 11 + cw, top + 35, 1.5, 13);
    }
    const by = top + 64;
    if (ev.answer === 'approve') {
      const a = ss(0, 1, (t - (ev.answerAt ?? 0)) / 0.25);
      c.fillStyle = '#34C759';
      rrect(c, tx, by, 190, 24, 12);
      c.fill();
      c.save();
      c.globalAlpha *= a;
      textAt(c, tr(s, '✓ Разрешено'), tx + 95, by + 12.5, { size: 12, align: 'center', color: '#04210E' });
      c.restore();
    } else {
      kbdButton(s, c, tx, by, 102, 24, tr(s, 'Отклонить'), 'N', 'deny', false);
      kbdButton(s, c, tx + 110, by, 104, 24, tr(s, 'Разрешить'), 'Y', 'approve', true);
    }
  } else {
    const Q = (s.agent && s.agent.question) || QUESTION;
    textAt(c, s.agent && s.agent.question ? Q[0] : tr(s, Q[0]), tx, top + 38, { size: 12.5, weight: 600, max: tw });
    let ox = tx,
      full = false;
    Q[1].forEach((opt, i) => {
      c.save();
      c.font = '500 12px Onest, system-ui, sans-serif';
      const w = c.measureText(opt).width + 44;
      c.restore();
      // real options can be long: those that do not fit are answered in the terminal
      if (full || (s.agent && i > 0 && ox + w > tx + tw)) {
        full = true;
        return;
      }
      const y = top + 54,
        sel = ev.choice === i,
        hov = hovering(s, ox, y, w, 24);
      const appear = ss(0, 1, (el - 0.15 - i * 0.08) / 0.25);
      c.save();
      c.globalAlpha *= appear;
      c.translate(0, (1 - appear) * 6);
      c.fillStyle = sel ? '#22C3E6' : hov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)';
      rrect(c, ox, y, w, 24, 12);
      c.fill();
      c.strokeStyle = sel ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)';
      c.lineWidth = 1;
      rrect(c, ox + 8, y + 5, 14, 14, 4);
      c.stroke();
      textAt(c, sel ? '✓' : String(i + 1), ox + 15, y + 12.5, {
        size: 9.5,
        mono: true,
        align: 'center',
        color: sel ? '#002A33' : 'rgba(255,255,255,0.65)',
      });
      textAt(c, opt, ox + 28, y + 12.5, { size: 12, color: sel ? '#002A33' : 'rgba(255,255,255,0.92)' });
      c.restore();
      if (ev.choice !== undefined && ev.choice < 0) addHit(s, c, { x: ox, y, w, h: 24, act: 'opt:' + i });
      ox += w + 6;
    });
  }
  if (!ev.answer) {
    const left = clamp(1 - el / E.dur, 0, 1);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, tx, cy1 - 9, tw, 2.5, 1.25);
    c.fill();
    c.fillStyle = left < 0.25 ? '#FF6B61' : E.color;
    rrect(c, tx, cy1 - 9, tw * left, 2.5, 1.25);
    c.fill();
  }
  c.restore();
}

/** proto: drawAlert - over-clicked: the mascot reboots, the island explains it with a tinted card and a countdown */
export function drawAlert(s: IslandState, c: Ctx, X0: number, X1: number, cy0: number, cy1: number): void {
  const W = X1 - X0,
    H = cy1 - cy0,
    left = Math.max(0, s.overloadUntil - s.t),
    el = 3.2 - left;
  const k = ss(0, 1, el / 0.3);
  c.save();
  c.globalAlpha *= k;
  c.translate(0, (1 - k) * -6);
  card(c, X0, cy0, W, H, false);
  cardTint(c, X0, cy0, W, H, '#FF5FA2', 0.45);
  cardMascot(s, c, X0, cy0, cy1, null, null);
  const tx = X0 + 88;
  textAt(c, tr(s, 'Слишком много тыков'), tx, cy0 + H / 2 - 9, { size: 14, weight: 600, max: X1 - tx - 14 });
  textAt(
    c,
    left > 0 ? tr(s, 'Перезагружаюсь - вернусь через {0} с', Math.ceil(left)) : tr(s, 'Снова на связи'),
    tx,
    cy0 + H / 2 + 11,
    { size: 12, weight: 400, color: 'rgba(255,255,255,0.6)', max: X1 - tx - 14 },
  );
  c.fillStyle = 'rgba(255,255,255,0.08)';
  rrect(c, tx, cy1 - 14, X1 - tx - 16, 2.5, 1.25);
  c.fill();
  c.fillStyle = '#FF5FA2';
  rrect(c, tx, cy1 - 14, (X1 - tx - 16) * clamp(left / 3.2, 0, 1), 2.5, 1.25);
  c.fill();
  c.restore();
}

/** proto: STARS - fixed pseudo-random stars from Math.sin, no rng */
export const STARS: readonly { a: number; s: number; d: number }[] = Array.from({ length: 110 }, (_, i) => {
  const r1 = Math.sin(i * 12.9898) * 43758.5453,
    r2 = Math.sin(i * 78.233) * 12345.678;
  return { a: (r1 - Math.floor(r1)) * Math.PI * 2, s: 0.35 + (r2 - Math.floor(r2)) * 0.9, d: (i * 0.618) % 1 };
});

/** proto: drawLaunch - a warp of particles flies out of the camera, the mascot appears in the middle and says hello */
export function drawLaunch(s: IslandState, c: Ctx, X0: number, X1: number, cy0: number, cy1: number): void {
  const ev = s.event;
  if (!ev) return;
  const t = s.t;
  const W = X1 - X0,
    H = cy1 - cy0,
    el = t - ev.start,
    cx = (X0 + X1) / 2,
    cy = (cy0 + cy1) / 2;
  card(c, X0, cy0, W, H, false);
  c.save();
  rrect(c, X0, cy0, W, H, 14);
  c.clip();
  const warp = clamp(el / 1.0, 0, 1),
    fade = el > 3.8 ? clamp(1 - (el - 3.8) / 0.8, 0, 1) : 1;
  for (const st of STARS) {
    // fast outward rush during the warp, then a slow drift with a twinkle
    const r = (Math.pow(warp, 1.8) * 0.9 + Math.max(0, el - 1) * 0.06 + st.d * 0.12) * W * 0.55 * st.s;
    const x = cx + Math.cos(st.a) * r,
      y = cy + Math.sin(st.a) * r * 0.42;
    const tw = 0.55 + 0.45 * Math.sin(t * 3 + st.d * 20);
    const a = (warp < 1 ? 0.25 + 0.75 * warp : tw) * fade * 0.85;
    if (warp < 1) {
      const r0 = r * 0.82,
        x0 = cx + Math.cos(st.a) * r0,
        y0 = cy + Math.sin(st.a) * r0 * 0.42;
      c.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x, y);
      c.stroke();
    } else {
      c.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      c.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }
  }
  const glow = clamp((el - 0.6) / 0.8, 0, 1) * fade;
  if (glow > 0) {
    const g = c.createRadialGradient(cx, cy, 4, cx, cy, 70);
    g.addColorStop(0, 'rgba(210,230,255,' + (0.28 * glow).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(210,230,255,0)');
    c.fillStyle = g;
    c.fillRect(cx - 70, cy - 70, 140, 140);
  }
  c.restore();
  const R = 25,
    gy = cy + R * 0.92;
  if (el > 0.9) {
    drawMascot(s, c, cx, gy, R, 'card', '#111112');
    s.mascotSpots.push({ x: cx, y: gy - R, a: c.globalAlpha });
    if (c.globalAlpha > 0.5) s.islandMascot = { x: cx, y: gy - R * 0.92, R };
    addHit(s, c, { x: cx - R * 1.1, y: gy - R * 2, w: R * 2.2, h: R * 2, act: 'mascot', cx, cy: gy - R * 0.92, R });
  }
  const st = statusOf(s);
  if (st && st.text) textAt(c, st.text, cx + R + 22, cy + 0.5, { size: 15, weight: 600 });
}
