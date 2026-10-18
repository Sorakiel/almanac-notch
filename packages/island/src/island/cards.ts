// Cards of the home tab: the focus card, approvals and questions, the overload alert, the launch warp.
import { plural, tr } from '../i18n';
import { clamp, ss } from '../util/math';
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
import { deployDot, drawGlyph, modules, pageMark, prIcon, type ModuleItem } from './modules';

/** the muted word after the name in coucou's card head */
const HEAD_WORD: Partial<Record<ModuleId, string>> = { vercel: 'Деплои', notion: 'Недавние', grafana: 'Алерты' };

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

/** proto: drawSteps - the last three tool calls, the newest sliding in on top */
export function drawSteps(s: IslandState, c: Ctx, tx: number, y0: number, tmax: number): void {
  const ev = s.event;
  if (!ev) return;
  const cur = stepIndex(s),
    frac = stepFrac(s),
    k = ss(0, 1, frac / 0.18);
  for (let j = 0; j < 3; j++) {
    const st = stepAt(s, cur - j);
    if (!st) break;
    const y = y0 + 40 + j * 18 + (j === 0 ? (1 - k) * -6 : 0) + (j > 0 ? (1 - k) * -18 : 0);
    c.save();
    c.globalAlpha *= j === 0 ? k : 1 - j * 0.25;
    const tag = TOOL_TAG[st[0]];
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, tx, y - 7, 14, 14, 4);
    c.fill();
    textAt(c, tag[0], tx + 7, y + 0.5, { mono: true, size: 10, weight: 600, align: 'center', color: tag[1] });
    textAt(c, st[2], tx + 19, y + 0.5, {
      mono: true,
      size: 11,
      weight: 400,
      color: j === 0 ? '#FFFFFF' : 'rgba(255,255,255,0.7)',
      max: tmax - 19 - (st[3] ? 50 : 0),
    });
    if (st[3]) {
      textAt(c, st[3], tx + tmax - 26, y + 0.5, { mono: true, size: 10.5, color: '#5FD27D', align: 'right' });
      textAt(c, st[4] as string, tx + tmax, y + 0.5, { mono: true, size: 10.5, color: '#FF6B61', align: 'right' });
    }
    c.restore();
  }
}

/** "последняя сессия N мин назад" from the newest hook */
function lastSession(s: IslandState, at: number | null): string {
  if (at === null) return tr(s, 'сессий ещё не было');
  const min = Math.floor((s.date().getTime() - at) / 60000);
  if (min < 1) return tr(s, 'последняя сессия только что');
  if (min < 60) return tr(s, 'последняя сессия {0} мин назад', min);
  const h = Math.floor(min / 60);
  return h < 24 ? tr(s, 'последняя сессия {0} ч назад', h) : tr(s, 'последняя сессия давно');
}

function commitsWord(s: IslandState, n: number): string {
  if (s.lang === 'en') return plural(n, ' commit', ' commits');
  const m10 = n % 10,
    m100 = n % 100;
  return m10 === 1 && m100 !== 11
    ? ' коммит'
    : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
      ? ' коммита'
      : ' коммитов';
}

/**
 * Not in the prototype (docs/CHANGES.md): coucou's card head - a dot in the module colour, the
 * name, a muted word ("Деплои", "Недавние", "Алерты"), an optional arrow (Vercel: the newest
 * deployment, Grafana: the alert list).
 */
function brandHead(s: IslandState, c: Ctx, id: ModuleId, name: string, tx: number, y0: number, x1: number): void {
  c.fillStyle = MODULE_COL[id].body;
  c.beginPath();
  c.arc(tx + 4, y0 + 18, 4, 0, Math.PI * 2);
  c.fill();
  textAt(c, name, tx + 14, y0 + 18.5, { size: 13, weight: 600 });
  c.save();
  c.font = '600 13px Onest, system-ui, sans-serif';
  const nw = c.measureText(name).width;
  c.restore();
  textAt(c, tr(s, HEAD_WORD[id] ?? ''), tx + 20 + nw, y0 + 18.5, {
    size: 12,
    weight: 400,
    color: T_MUTED,
  });
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
  textAt(c, b.value, tx, y + 25.5, { size: 14, weight: 600, color: '#FFFFFF', max: gx0 - tx - 6 });
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
  if (it.kind === 'deploy' || it.kind === 'pages' || it.kind === 'alerts') brandHead(s, c, it.id, it.name, tx, y0, x1);
  else {
    drawGlyph(s, c, it, tx + 6, y0 + 18, 5.5);
    textAt(c, it.name, tx + 17, y0 + 18.5, { size: 13, weight: 600, max: tmax - 17 });
  }
  const L = (i: number, str: string, color?: string, mono?: boolean): void =>
    textAt(c, str, tx, y0 + 40 + i * 18, {
      size: mono ? 11 : 11.5,
      weight: 400,
      color: color || 'rgba(255,255,255,0.75)',
      ...(mono ? { mono } : {}),
      max: tmax,
    });
  if (it.kind === 'agent') {
    if (it.state === 'work') drawSteps(s, c, tx, y0, tmax);
    else if (it.state === 'search') {
      L(0, tr(s, 'ищет по проекту'), '#5FD6F0');
      L(1, s.agent ? s.agent.search : tr(s, 'grep "rrect(" · 14 совпадений'), T_MUTED);
    } else if (it.state === 'limit') {
      L(0, tr(s, 'лимит плана исчерпан'), '#C7C7CC');
      L(1, tr(s, 'сброс через {0}', limitText(s)), T_MUTED);
      L(2, tr(s, 'план {0} · окно 5 часов', s.agent ? s.agent.plan : 'Pro'), T_MUTED);
    } else if (it.state === 'think') {
      L(0, tr(s, s.agent ? 'думает' : 'планирует изменения'), '#BFA6FF');
      L(1, s.agent ? s.agent.think : tr(s, 'смотрит структуру проекта'), T_MUTED);
    } else {
      L(0, tr(s, 'свободен'));
      L(1, s.agent ? lastSession(s, s.agent.lastActive) : tr(s, 'последняя сессия {0} мин назад', 12), T_MUTED);
    }
  } else if (it.kind === 'ci' && s.github && s.github.auth !== 'ok') {
    // live GitHub with nothing to show: say why and where to connect
    L(0, s.github.hint[0], '#FFFFFF');
    L(1, s.github.hint[1], T_MUTED);
  } else if (it.kind === 'ci') {
    const gh = s.github,
      ciCol =
        it.state === 'fail' ? '#FF6B61' : it.state === 'run' ? '#7FB0FF' : it.state === 'off' ? '#8E8E93' : '#5FD27D';
    drawGlyph(s, c, { kind: 'ci', state: it.state }, tx + 6, y0 + 40, 6.8);
    textAt(
      c,
      gh
        ? gh.ciText
        : tr(
            s,
            it.state === 'fail'
              ? 'деплой упал на build'
              : it.state === 'run'
                ? 'CI идёт · 2 из 5'
                : 'CI зелёный · 5 из 5',
          ),
      tx + 18,
      y0 + 40.5,
      { size: 11.5, weight: 400, color: ciCol, max: tmax - 18 },
    );
    prIcon(c, tx + 6, y0 + 59);
    textAt(c, gh ? gh.prText : tr(s, '2 PR ждут ревью'), tx + 18, y0 + 59.5, {
      size: 11.5,
      weight: 400,
      color: 'rgba(255,255,255,0.8)',
      max: tmax - 18,
    });
    // commits over the last 7 days, today on the right
    const CM = gh ? gh.commits : [4, 0, 6, 9, 3, 7, 5],
      mxc = Math.max(...CM),
      bw = 6,
      bg = 3,
      base = y0 + 88;
    CM.forEach((v, i) => {
      const hh = v ? 3 + (v / mxc) * 13 : 2,
        x = tx + i * (bw + bg);
      c.fillStyle = !v ? 'rgba(255,255,255,0.15)' : i === CM.length - 1 ? '#5FD27D' : 'rgba(95,210,125,0.5)';
      rrect(c, x, base - hh, bw, hh, 1.5);
      c.fill();
    });
    const nC = CM.reduce((a, b) => a + b, 0);
    // live: the word does not fit next to the bars without being squeezed
    textAt(c, tr(s, '{0} за 7 дн', gh ? nC : nC + commitsWord(s, nC)), tx + CM.length * (bw + bg) + 6, base - 6, {
      size: 11,
      weight: 400,
      color: T_MUTED,
      max: tmax - CM.length * (bw + bg) - 6,
    });
  } else if (it.kind === 'deploy' && s.vercel) {
    // not in the prototype (docs/CHANGES.md): the newest deployments, as coucou's card
    const vc = s.vercel;
    if (vc.auth !== 'ok' || !vc.rows.length) {
      L(0, vc.hint[0], '#FFFFFF');
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
          color: i === 0 ? '#FFFFFF' : 'rgba(255,255,255,0.75)',
          max: tmax - 60,
        });
        textAt(c, r.ago, tx + 18 + nw, y + 0.5, { size: 11, weight: 400, color: T_MUTED, max: tmax - 18 - nw });
      });
  } else if (it.kind === 'pages' && s.notion) {
    // not in the prototype (docs/CHANGES.md): the pages edited last, as coucou's card; a row opens the page
    const no = s.notion;
    if (no.auth !== 'ok' || !no.rows.length) {
      L(0, no.hint[0], '#FFFFFF');
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
      L(0, gf.hint[0], '#FFFFFF');
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
        L(0, gf.hint[0], '#FFFFFF');
        if (!gf.board && gf.hint[1]) L(1, gf.hint[1], T_MUTED);
      }
      if (gf.board) boardBlock(s, c, gf.board, tx, y0 + 51, tmax);
    }
  } else if (it.kind === 'cal' && s.cal) {
    const cal = s.cal;
    if (cal.mins === null) {
      L(0, cal.title, '#FFFFFF');
      L(1, cal.after, T_MUTED);
    } else {
      L(
        0,
        (cal.mins <= 0 ? tr(s, 'сейчас') : tr(s, 'через {0}', minsText(s, cal.mins))) + ' · ' + cal.at,
        cal.mins <= 5 ? '#F5B94A' : '#FFFFFF',
      );
      L(1, cal.title);
      if (cal.after) L(2, cal.after, T_MUTED);
    }
  } else if (it.kind === 'cal') {
    L(0, tr(s, 'через {0} мин · 15:00', it.mins), it.mins <= 5 ? '#F5B94A' : '#FFFFFF');
    L(1, tr(s, 'Созвон с командой'));
    L(2, tr(s, 'дальше: лекция в 17:10'), T_MUTED);
  } else if (it.kind === 'music') {
    const trk = s.media ? ([s.media.title, s.media.sub] as const) : (TRACKS[s.trackIdx] as readonly [string, string]);
    // live track names pass through; the stub and the "nothing playing" lines are keys
    L(0, s.media && !s.media.idle ? trk[0] : tr(s, trk[0]), '#FFFFFF');
    L(1, s.media && !s.media.idle ? trk[1] : tr(s, trk[1]), T_MUTED);
    const by = y1 - 16,
      cx = tx + tmax / 2;
    const ctrl = (x: number, act: string, draw: (x: number) => void): void => {
      const hov = hovering(s, x - 12, by - 11, 24, 22);
      if (hov) {
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.beginPath();
        c.arc(x, by, 11, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#FFFFFF';
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
  } else {
    s.habits.slice(0, 3).forEach((h, i) => {
      const y = y0 + 40 + i * 18,
        hov = hovering(s, tx - 2, y - 8, tmax, 16);
      c.strokeStyle = h[1] ? '#F4A9C6' : 'rgba(255,255,255,0.4)';
      c.fillStyle = '#F4A9C6';
      c.lineWidth = 1.4;
      rrect(c, tx, y - 5, 10, 10, 3);
      if (h[1]) c.fill();
      else c.stroke();
      if (h[1]) {
        c.strokeStyle = '#16171A';
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(tx + 2.5, y);
        c.lineTo(tx + 4.5, y + 2.2);
        c.lineTo(tx + 7.8, y - 2.4);
        c.stroke();
      }
      textAt(c, tr(s, h[0]), tx + 16, y + 0.5, {
        size: 11.5,
        weight: 400,
        color: h[1] ? T_MUTED : hov ? '#FFFFFF' : 'rgba(255,255,255,0.85)',
        max: tmax - 16,
      });
      addHit(s, c, { x: tx - 2, y: y - 8, w: tmax, h: 16, act: 'habit:' + i });
    });
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
  const tx = X0 + 88,
    tw = X1 - tx - 14;
  c.fillStyle = E.color;
  c.beginPath();
  c.arc(tx + 3, cy0 + 17, 3, 0, Math.PI * 2);
  c.fill();
  textAt(c, 'Claude Code', tx + 12, cy0 + 17.5, { size: 12.5, weight: 600 });
  c.save();
  c.font = '600 12.5px Onest, system-ui, sans-serif';
  const nw = c.measureText('Claude Code').width;
  c.restore();
  textAt(c, tr(s, q ? 'спрашивает' : 'нужно разрешение'), tx + 18 + nw, cy0 + 17.5, {
    size: 12,
    weight: 400,
    color: T_MUTED,
  });
  if (!q) {
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, tx, cy0 + 28, tw, 26, 8);
    c.fill();
    const cmd = s.agent ? s.agent.cmd : 'git push origin main',
      n = clamp(Math.floor((el - 0.25) * 40), 0, cmd.length);
    textAt(c, cmd.slice(0, n), tx + 10, cy0 + 41.5, {
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
      c.fillRect(tx + 11 + cw, cy0 + 35, 1.5, 13);
    }
    const by = cy0 + 64;
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
    textAt(c, s.agent && s.agent.question ? Q[0] : tr(s, Q[0]), tx, cy0 + 38, { size: 12.5, weight: 600, max: tw });
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
      const y = cy0 + 54,
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
