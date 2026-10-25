import { clamp } from '../util/math';
import type { Ctx } from '../util/draw';
import { toWorld, type Pose } from '../sim/pose';
import type { IslandState } from '../sim/state';
import { statusOf } from '../sim/events';
import { tr } from '../i18n';
import { hoverK } from '../island/hover';

/** proto: drawBadge - the status dot, bottom right on the body, with a ring in the background colour.
 * 2026-10-19 (docs/CHANGES.md), after Grok Bot (clip 11/7): with the pointer on the mascot the dot
 * stretches outward into a pill that says the state ("Работает"), on a quick spring with a little
 * overshoot (spring(0.26, 0.64), t90 ≈ 0.1 s), and folds back when the pointer leaves */
/** one word for the state, as Grok Bot's "Working" - the full status is in the card already */
const WORD: Record<string, string> = {
  working: 'работает',
  thinking: 'думает',
  searching: 'ищет',
  attention: 'ждёт',
  question: 'спрашивает',
  success: 'готово',
  error: 'ошибка',
  nudge: 'напоминает',
  dance: 'танцует',
};

export function drawBadge(s: IslandState, c: Ctx, P: Pose, ring: string): void {
  const a = clamp(s.sp.badge.x, 0, 1.4);
  if (a < 0.02) return;
  const [bx, by] = toWorld(P, P.R * 0.7, P.b * 0.6);
  const r = (P.mini === 'notch' ? 3.3 : P.R * 0.13) * Math.min(a, 1.25),
    rr = r + (P.mini === 'notch' ? 1.6 : P.R * 0.05);
  // hover: the pointer within the body (the pointer is in this drawing's coordinates)
  const p = s.islandPtr,
    cy = P.ay - P.b * P.sy,
    over = P.mini !== 'notch' && !!p && Math.hypot(p.x - P.ax, p.y - cy) < P.R * 1.15;
  const st = P.mini !== 'notch' ? statusOf(s) : null,
    k = st ? hoverK(s, 'badge', over, 0.26, 0.64) : 0;
  c.save();
  c.globalAlpha *= Math.min(1, a);
  if (k > 0.01 && st) {
    const word = s.event ? WORD[s.event.type] : s.sleeping ? 'спит' : undefined,
      label = word ? tr(s, word) : st.text.replace(/[….]+$/, ''),
      size = Math.max(9, P.R * 0.36);
    c.font = `600 ${size}px Onest, system-ui, sans-serif`;
    const tw = c.measureText(label).width,
      h = Math.max(r * 2, size + 6),
      w = r * 2 + (tw + size) * k,
      // grows to the left, over the body, so it never covers the card's text
      x0 = bx + r - Math.max(h, w),
      y0 = by - h / 2;
    const pill = (pad: number) => {
      c.beginPath();
      c.roundRect(x0 - pad, y0 - pad, Math.max(h, w) + pad * 2, h + pad * 2, h / 2 + pad);
    };
    c.fillStyle = ring;
    pill(rr - r);
    c.fill();
    c.fillStyle = s.badgeColor;
    pill(0);
    c.fill();
    const ta = clamp((k - 0.45) / 0.5, 0, 1);
    if (ta > 0) {
      c.save();
      c.globalAlpha *= ta;
      pill(0);
      c.clip();
      c.fillStyle = '#0B0B0D';
      c.textBaseline = 'middle';
      c.fillText(label, x0 + size * 0.55, by + 0.5);
      c.restore();
    }
  } else {
    c.fillStyle = ring;
    c.beginPath();
    c.arc(bx, by, rr, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = s.badgeColor;
    c.beginPath();
    c.arc(bx, by, r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}
