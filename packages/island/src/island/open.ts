// Open state: top bar with tabs and settings, then the active tab (docs/SPEC.md 2.4-2.9).
import { clamp, ss } from '../util/math';
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState, Tab } from '../sim/state';
import type { Status } from '../sim/events';
import type { WorkFx } from './fx';
import { effectiveFocus } from './focus';
import { addHit, hovering } from './hits';
import { T_MUTED } from './half';
import { card, cardTint } from './card';
import { drawAlert, drawAsk, drawFocusCard, drawLaunch } from './cards';
import { drawMusicWide, drawRail } from './music';
import { drawAdd, drawChat, drawSettings } from './tabs';
import { drawGlyph, focusTint, idleShort, isHot, modules } from './modules';

type IconKind = 'home' | 'chat' | 'add' | 'gear' | 'sound';

/** proto: icon */
export function icon(s: IslandState, c: Ctx, kind: IconKind, x: number, y: number, active: boolean): void {
  if (s.iconSet === 'solid') return solidIcon(s, c, kind, x, y, active);
  c.save();
  c.strokeStyle = c.fillStyle = active ? '#FFFFFF' : 'rgba(255,255,255,0.6)';
  c.lineWidth = 1.5;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (kind === 'home') {
    c.beginPath();
    c.moveTo(x - 6, y - 0.5);
    c.lineTo(x, y - 6);
    c.lineTo(x + 6, y - 0.5);
    c.moveTo(x - 4.5, y - 2);
    c.lineTo(x - 4.5, y + 5);
    c.lineTo(x + 4.5, y + 5);
    c.lineTo(x + 4.5, y - 2);
    c.stroke();
  } else if (kind === 'chat') {
    rrect(c, x - 6.5, y - 5.5, 13, 9.5, 3);
    c.stroke();
    c.beginPath();
    c.moveTo(x - 3, y + 4);
    c.lineTo(x - 4.5, y + 6.5);
    c.lineTo(x, y + 4);
    c.stroke();
  } else if (kind === 'add') {
    c.beginPath();
    c.moveTo(x - 5.5, y);
    c.lineTo(x + 5.5, y);
    c.moveTo(x, y - 5.5);
    c.lineTo(x, y + 5.5);
    c.stroke();
  } else if (kind === 'gear') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * 4.6, y + Math.sin(a) * 4.6);
      c.lineTo(x + Math.cos(a) * 6.6, y + Math.sin(a) * 6.6);
      c.stroke();
    }
    c.beginPath();
    c.arc(x, y, 4.4, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(x, y, 1.6, 0, Math.PI * 2);
    c.stroke();
  } else {
    c.beginPath();
    c.moveTo(x - 6, y - 2.2);
    c.lineTo(x - 3.5, y - 2.2);
    c.lineTo(x, y - 5.2);
    c.lineTo(x, y + 5.2);
    c.lineTo(x - 3.5, y + 2.2);
    c.lineTo(x - 6, y + 2.2);
    c.closePath();
    c.stroke();
    if (s.muted) {
      c.beginPath();
      c.moveTo(x + 2.5, y - 3);
      c.lineTo(x + 7, y + 3);
      c.moveTo(x + 7, y - 3);
      c.lineTo(x + 2.5, y + 3);
      c.stroke();
    } else {
      c.beginPath();
      c.arc(x + 1, y, 3.4, -0.9, 0.9);
      c.stroke();
      c.beginPath();
      c.arc(x + 1, y, 6.2, -0.9, 0.9);
      c.stroke();
    }
  }
  c.restore();
}

// Filled top-bar icons for the app (docs/CHANGES.md 2026-10-17): drawn on a 24-unit grid,
// scaled to the prototype's ~13 px glyph box. Paths are our own, not a system symbol set.
const SOLID_SCALE = 0.62;
const P_HOME =
  'M12 3.3c.4 0 .8.1 1.1.4l8.2 7.1c.7.6.3 1.7-.6 1.7H19.5v7.4c0 .9-.7 1.6-1.6 1.6h-3.4v-5.2c0-.6-.4-1-1-1h-3c-.6 0-1 .4-1 1v5.2H6.1c-.9 0-1.6-.7-1.6-1.6v-7.4H3.3c-.9 0-1.3-1.1-.6-1.7l8.2-7.1c.3-.3.7-.4 1.1-.4Z';
const P_CHAT =
  'M6.2 4h11.6c2 0 3.7 1.7 3.7 3.7v6.1c0 2-1.7 3.7-3.7 3.7h-6.9l-4.6 3.3c-.6.4-1.4-.1-1.2-.8l.6-2.6c-1.7-.4-3.2-1.9-3.2-3.6V7.7C2.5 5.7 4.2 4 6.2 4Z';
const P_SPEAKER =
  'M4 8.6h2.9l4.5-3.8c.7-.6 1.7-.1 1.7.8v12.8c0 .9-1 1.4-1.7.8l-4.5-3.8H4c-.8 0-1.5-.7-1.5-1.5V10.1c0-.8.7-1.5 1.5-1.5Z';
const pathCache = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) pathCache.set(d, (p = new Path2D(d)));
  return p;
}
/** a cog: 8 rounded teeth around a ring, the hole cut out (even-odd) */
function gearPath(): Path2D {
  let p = pathCache.get('gear');
  if (p) return p;
  p = new Path2D();
  const teeth = 8,
    rIn = 7.4,
    rOut = 10.2,
    half = (Math.PI / teeth) * 0.42;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2,
      r = i % 2 === 0 ? rOut : rIn,
      w = i % 2 === 0 ? half : half * 1.25;
    const x0 = 12 + Math.cos(a - w) * r,
      y0 = 12 + Math.sin(a - w) * r;
    if (i === 0) p.moveTo(x0, y0);
    else p.lineTo(x0, y0);
    p.lineTo(12 + Math.cos(a + w) * r, 12 + Math.sin(a + w) * r);
  }
  p.closePath();
  p.moveTo(12 + 3.1, 12);
  p.arc(12, 12, 3.1, 0, Math.PI * 2);
  pathCache.set('gear', p);
  return p;
}

function solidIcon(s: IslandState, c: Ctx, kind: IconKind, x: number, y: number, active: boolean): void {
  c.save();
  const col = active ? '#FFFFFF' : 'rgba(255,255,255,0.55)';
  c.fillStyle = c.strokeStyle = col;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.translate(x - 12 * SOLID_SCALE, y - 12 * SOLID_SCALE);
  c.scale(SOLID_SCALE, SOLID_SCALE);
  if (kind === 'home') c.fill(path(P_HOME));
  else if (kind === 'chat') c.fill(path(P_CHAT));
  else if (kind === 'add') {
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(12, 4.5);
    c.lineTo(12, 19.5);
    c.moveTo(4.5, 12);
    c.lineTo(19.5, 12);
    c.stroke();
  } else if (kind === 'gear') {
    // stroke-join softens the teeth corners
    c.lineWidth = 1.4;
    c.fill(gearPath(), 'evenodd');
    c.stroke(gearPath());
  } else {
    c.fill(path(P_SPEAKER));
    c.lineWidth = 2;
    c.beginPath();
    if (s.muted) {
      c.moveTo(16, 9.5);
      c.lineTo(21, 14.5);
      c.moveTo(21, 9.5);
      c.lineTo(16, 14.5);
    } else {
      c.arc(13.5, 12, 3.6, -0.85, 0.85);
      c.moveTo(13.5 + Math.cos(-0.85) * 7, 12 + Math.sin(-0.85) * 7);
      c.arc(13.5, 12, 7, -0.85, 0.85);
    }
    c.stroke();
  }
  c.restore();
}

/** proto: topBar */
export function topBar(s: IslandState, c: Ctx, x0: number, x1: number, y: number): void {
  const tabs: [Tab & IconKind, string][] = [
    ['home', 'tab:home'],
    ['chat', 'tab:chat'],
    ['add', 'tab:add'],
  ].filter(([k]) => !(s.chatOff && k === 'chat')) as [Tab & IconKind, string][];
  tabs.forEach(([k, act], i) => {
    const x = x0 + 22 + i * 30,
      on = s.tab === k,
      hov = hovering(s, x - 13, y - 11, 26, 22);
    if (on || hov) {
      c.fillStyle = on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)';
      rrect(c, x - 13, y - 11, 26, 22, 11);
      c.fill();
    }
    icon(s, c, k, x, y, on);
    addHit(s, c, { x: x - 13, y: y - 11, w: 26, h: 22, act });
  });
  // the app has no sounds yet (stage 9): no speaker, the gear takes its place (docs/CHANGES.md)
  const right: [IconKind, string, number][] = s.host
    ? [['gear', 'tab:settings', x1 - 22]]
    : [
        ['gear', 'tab:settings', x1 - 50],
        ['sound', 'mute', x1 - 22],
      ];
  right.forEach(([k, act, x]) => {
    const on = k === 'gear' && s.tab === 'settings',
      hov = hovering(s, x - 13, y - 11, 26, 22);
    if (on || hov) {
      c.fillStyle = on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)';
      rrect(c, x - 13, y - 11, 26, 22, 11);
      c.fill();
    }
    icon(s, c, k, x, y, on);
    addHit(s, c, { x: x - 13, y: y - 11, w: 26, h: 22, act });
  });
}

/** proto: drawOpen */
export function drawOpen(
  s: IslandState,
  c: Ctx,
  x0: number,
  x1: number,
  top: number,
  bottom: number,
  _st: Status | null,
  fx: WorkFx | null,
  barY: number,
): void {
  topBar(s, c, x0, x1, barY);
  const pad = 10,
    cy0 = top + 2,
    cy1 = bottom - pad,
    X0 = x0 + pad,
    X1 = x1 - pad;
  if (cy1 - cy0 < 40) return;
  if (s.event && s.event.type === 'greeting') {
    drawLaunch(s, c, X0, X1, cy0, cy1);
    return;
  }
  const aA = clamp(s.sp.alertA.x, 0, 1);
  if (aA > 0.01) {
    c.save();
    c.globalAlpha *= aA;
    drawAlert(s, c, X0, X1, cy0, cy1);
    c.restore();
  }
  if (aA < 0.99) {
    c.save();
    c.globalAlpha *= 1 - aA;
    c.translate(0, aA * 6);
    drawOpenBody(s, c, X0, X1, cy0, cy1, fx);
    c.restore();
  }
}

/** proto: drawOpenBody - the active tab; on home the focus card plus the other modules */
export function drawOpenBody(
  s: IslandState,
  c: Ctx,
  X0: number,
  X1: number,
  cy0: number,
  cy1: number,
  fx: WorkFx | null,
): void {
  if (s.tab === 'chat' && !s.chatOff) return drawChat(s, c, X0, X1, cy0, cy1);
  if (s.tab === 'add') return drawAdd(s, c, X0, X1, cy0, cy1);
  if (s.tab === 'settings') return drawSettings(s, c, X0, X1, cy0, cy1);
  const split = X0 + (X1 - X0) * 0.52,
    gap = 8;
  if (s.event && (s.event.type === 'attention' || s.event.type === 'question'))
    return drawAsk(s, c, X0, X1, cy0, cy1, fx);
  const f = effectiveFocus(s);
  const k = ss(0, 1, (s.t - s.focusStart) / 0.28);
  if (f === 'music') {
    c.save();
    c.globalAlpha *= k;
    c.translate((1 - k) * 8, 0);
    drawMusicWide(s, c, X0, X1 - 44, cy0, cy1);
    c.restore();
    drawRail(
      s,
      c,
      X1 - 36,
      X1,
      cy0,
      cy1,
      modules(s).filter((m) => m.id !== 'music'),
    );
    return;
  }
  card(c, X0, cy0, split - X0 - gap / 2, cy1 - cy0, false);
  const tintC = focusTint(s, f);
  if (tintC) cardTint(c, X0, cy0, split - X0 - gap / 2, cy1 - cy0, tintC.c, tintC.a);
  c.save();
  c.globalAlpha *= k;
  c.translate((1 - k) * 8, 0);
  drawFocusCard(s, c, f, X0, cy0, split - gap / 2, cy1, fx);
  c.restore();
  // the other four modules as a 2 × 2 grid of chips
  const items = modules(s).filter((m) => m.id !== f);
  const gx0 = split + gap / 2,
    gw = (X1 - gx0 - gap) / 2,
    gh = (cy1 - cy0 - gap) / 2;
  items.slice(0, 4).forEach((it, i) => {
    const x = gx0 + (i % 2) * (gw + gap),
      y = cy0 + Math.floor(i / 2) * (gh + gap);
    const hov = hovering(s, x, y, gw, gh);
    c.fillStyle = hov ? 'rgba(255,255,255,0.13)' : isHot(it) ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.05)';
    rrect(c, x, y, gw, gh, 12);
    c.fill();
    drawGlyph(s, c, it, x + 17, y + gh / 2, it.kind === 'agent' ? 8 : 7.5);
    textAt(c, it.name, x + 32, y + gh / 2 - 7, { size: 12, max: gw - 38 });
    textAt(c, idleShort(s, it), x + 32, y + gh / 2 + 8, {
      size: 11,
      weight: 400,
      color: isHot(it) ? 'rgba(255,255,255,0.85)' : T_MUTED,
      max: gw - 38,
    });
    addHit(s, c, { x, y, w: gw, h: gh, act: 'focus:' + it.id });
  });
}
