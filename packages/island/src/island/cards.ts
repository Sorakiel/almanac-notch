// Cards of the home tab: the focus card, approvals and questions, the overload alert, the launch warp.
import { clamp, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState, ModuleId } from '../sim/state';
import { EVENTS, statusOf, stepAt, stepIndex } from '../sim/events';
import { drawMascot } from '../mascot/body';
import { propFor } from '../mascot/props';
import { STEP_LEN, TRACKS, limitLeft, type ToolKind } from '../stub';
import type { WorkFx } from './fx';
import { addHit, hovering } from './hits';
import { T_MUTED } from './half';
import { card, cardMascot, cardTint, kbdButton } from './card';
import { drawGlyph, modules, prIcon, type ModuleItem } from './modules';

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
    frac = ((s.t - ev.start) % STEP_LEN) / STEP_LEN,
    k = ss(0, 1, frac / 0.18);
  for (let j = 0; j < 3; j++) {
    const st = stepAt(cur - j),
      y = y0 + 40 + j * 18 + (j === 0 ? (1 - k) * -6 : 0) + (j > 0 ? (1 - k) * -18 : 0);
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

function commitsWord(n: number): string {
  const m10 = n % 10,
    m100 = n % 100;
  return m10 === 1 && m100 !== 11
    ? ' коммит'
    : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
      ? ' коммита'
      : ' коммитов';
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
  drawGlyph(s, c, it, tx + 6, y0 + 18, 5.5);
  textAt(c, it.name, tx + 17, y0 + 18.5, { size: 13, weight: 600, max: tmax - 17 });
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
      L(0, 'ищет по проекту', '#5FD6F0');
      L(1, 'grep "rrect(" · 14 совпадений', T_MUTED);
    } else if (it.state === 'limit') {
      L(0, 'лимит плана исчерпан', '#C7C7CC');
      L(1, 'сброс через ' + limitLeft(s.event ? s.t - s.event.start : 0), T_MUTED);
      L(2, 'план Pro · окно 5 часов', T_MUTED);
    } else if (it.state === 'think') {
      L(0, 'планирует изменения', '#BFA6FF');
      L(1, 'смотрит структуру проекта', T_MUTED);
    } else {
      L(0, 'свободен');
      L(1, 'последняя сессия 12 мин назад', T_MUTED);
    }
  } else if (it.kind === 'ci') {
    const ciCol = it.state === 'fail' ? '#FF6B61' : it.state === 'run' ? '#7FB0FF' : '#5FD27D';
    drawGlyph(s, c, { kind: 'ci', state: it.state }, tx + 6, y0 + 40, 6.8);
    textAt(
      c,
      it.state === 'fail' ? 'деплой упал на build' : it.state === 'run' ? 'CI идёт · 2 из 5' : 'CI зелёный · 5 из 5',
      tx + 18,
      y0 + 40.5,
      { size: 11.5, weight: 400, color: ciCol, max: tmax - 18 },
    );
    prIcon(c, tx + 6, y0 + 59);
    textAt(c, '2 PR ждут ревью', tx + 18, y0 + 59.5, {
      size: 11.5,
      weight: 400,
      color: 'rgba(255,255,255,0.8)',
      max: tmax - 18,
    });
    // commits over the last 7 days, today on the right
    const CM = [4, 0, 6, 9, 3, 7, 5],
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
    textAt(c, nC + commitsWord(nC) + ' за 7 дн', tx + CM.length * (bw + bg) + 6, base - 6, {
      size: 11,
      weight: 400,
      color: T_MUTED,
      max: tmax - CM.length * (bw + bg) - 6,
    });
  } else if (it.kind === 'cal') {
    L(0, 'через ' + it.mins + ' мин · 15:00', it.mins <= 5 ? '#F5B94A' : '#FFFFFF');
    L(1, 'Созвон с командой');
    L(2, 'дальше: лекция в 17:10', T_MUTED);
  } else if (it.kind === 'music') {
    const tr = TRACKS[s.trackIdx] as readonly [string, string];
    L(0, tr[0], '#FFFFFF');
    L(1, tr[1], T_MUTED);
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
      textAt(c, h[0], tx + 16, y + 0.5, {
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
  textAt(c, q ? 'спрашивает' : 'нужно разрешение', tx + 18 + nw, cy0 + 17.5, {
    size: 12,
    weight: 400,
    color: T_MUTED,
  });
  if (!q) {
    c.fillStyle = 'rgba(255,255,255,0.08)';
    rrect(c, tx, cy0 + 28, tw, 26, 8);
    c.fill();
    const cmd = 'git push origin main',
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
      textAt(c, '✓ Разрешено', tx + 95, by + 12.5, { size: 12, align: 'center', color: '#04210E' });
      c.restore();
    } else {
      kbdButton(s, c, tx, by, 102, 24, 'Отклонить', 'N', 'deny', false);
      kbdButton(s, c, tx + 110, by, 104, 24, 'Разрешить', 'Y', 'approve', true);
    }
  } else {
    textAt(c, QUESTION[0], tx, cy0 + 38, { size: 12.5, weight: 600, max: tw });
    let ox = tx;
    QUESTION[1].forEach((opt, i) => {
      c.save();
      c.font = '500 12px Onest, system-ui, sans-serif';
      const w = c.measureText(opt).width + 44;
      c.restore();
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
  textAt(c, 'Слишком много тыков', tx, cy0 + H / 2 - 9, { size: 14, weight: 600, max: X1 - tx - 14 });
  textAt(
    c,
    left > 0 ? 'Перезагружаюсь - вернусь через ' + Math.ceil(left) + ' с' : 'Снова на связи',
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
