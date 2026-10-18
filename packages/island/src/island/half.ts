// Half-open: the mascot in the left ear, status or the crew in the right one (docs/SPEC.md 2.3).
import { tr } from '../i18n';
import { clamp } from '../util/math';
import { textAt, type Ctx } from '../util/draw';
import type { IslandState } from '../sim/state';
import type { Status } from '../sim/events';
import { drawMascot } from '../mascot/body';
import { mascotMarks } from '../mascot/marks';
import { drawWaveDots, type WorkFx } from './fx';
import { addHit, button } from './hits';
import { drawMini, miniCrew } from './crew';

/** proto: T_MUTED */
export const T_MUTED = 'rgba(255,255,255,0.55)';

/** where the right ear's content goes (proto: drawHalf's earRight) */
export interface EarRight {
  /** text start, cx + nw/2 + 9 */
  x: number;
  /** left edge of the strip */
  x0: number;
  /** current right ear width */
  w: number;
  /** right edge of the strip */
  end: number;
}

/** proto: approvalBlock - the block that drops under the strip for approvals and questions */
export function approvalBlock(s: IslandState, c: Ctx, x0: number, x1: number, top: number, h: number): void {
  const k = clamp((h - 20) / 40, 0, 1);
  if (k < 0.05) return;
  c.save();
  c.globalAlpha *= k;
  const cx = (x0 + x1) / 2;
  const q = s.event && s.event.type === 'question';
  textAt(c, tr(s, q ? 'Claude Code спрашивает' : 'Claude Code хочет выполнить'), cx, top + 12, {
    align: 'center',
    max: x1 - x0 - 24,
  });
  if (h > 44) {
    if (q)
      textAt(c, tr(s, 'наведи на остров, чтобы ответить'), cx, top + 36, {
        size: 11,
        weight: 400,
        align: 'center',
        color: T_MUTED,
      });
    else {
      const bw = 74;
      button(s, c, cx - bw - 4, top + 27, bw, 20, tr(s, 'Отклонить'), 'deny', false);
      button(s, c, cx + 4, top + 27, bw, 20, tr(s, 'Разрешить'), 'approve', true);
    }
  }
  c.restore();
}

/** proto: drawHalf */
export function drawHalf(
  s: IslandState,
  c: Ctx,
  ex0: number,
  earRight: EarRight,
  h: number,
  st: Status | null,
  fx: WorkFx | null,
  gyTop: number,
): void {
  const lim = s.event && s.event.type === 'ratelimit',
    mcx = ex0 + (lim ? 21 : 23),
    gy = gyTop + 27;
  mascotMarks(s, c, fx, mcx, gy - 10.5, 11.5, false);
  drawMascot(s, c, mcx, gy, 11.5, 'notch', '#000');
  mascotMarks(s, c, fx, mcx, gy - 10.5, 11.5, true);
  s.mascotSpots.push({ x: mcx, y: gy - 10, a: c.globalAlpha });
  if (c.globalAlpha > 0.5) s.islandMascot = { x: mcx, y: gy - 10.5, R: 11.5 };
  addHit(s, c, { x: mcx - 13, y: gy - 23, w: 26, h: 24, act: 'mascot', cx: mcx, cy: gy - 10.5, R: 11.5 });
  let tx = earRight.x;
  if (st && !st.drop) {
    if (fx && s.S.workfx === 'dots') {
      drawWaveDots(s, c, fx, tx + 2, gyTop + 16);
      tx += 26;
    }
    const k = clamp((earRight.w - 50) / 40, 0, 1);
    c.save();
    c.globalAlpha *= k;
    textAt(c, st.text, tx, gyTop + 16.5, { max: Math.max(10, earRight.end - tx - 8) });
    c.restore();
  } else if (!st) {
    // idle: the modules as a 2 × 2 crew of tiny mascots in their colours, looking across at the main one
    miniCrew(s).forEach((it, i) =>
      drawMini(s, c, tx + 8 + (i % 2) * 16, gyTop + 10 + Math.floor(i / 2) * 12.5, 5.3, it),
    );
  }
  if (st && st.drop) approvalBlock(s, c, earRight.x0, earRight.end, gyTop + 32, h - gyTop - 32);
}
