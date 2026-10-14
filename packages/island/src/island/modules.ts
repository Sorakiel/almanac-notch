// Module items for the open island: the list, glyphs and tints (docs/SPEC.md 2.4-2.5).
import { rrect, textAt, type Ctx } from '../util/draw';
import type { IslandState, ModuleId } from '../sim/state';
import { stepAt, stepIndex } from '../sim/events';
import { TRACKS, calMins, limitLeft } from '../stub';
import { MODULE_COL, claudeState, habitsDone, type ClaudeState } from './focus';
import { STATE_COL, drawMini } from './crew';

export type ModuleItem =
  | { id: 'claude'; kind: 'agent'; name: string; body: string; seed: number; state: ClaudeState; short: string }
  | { id: 'github'; kind: 'ci'; name: string; state: 'run' | 'fail' | 'ok'; short: string }
  | { id: 'cal'; kind: 'cal'; name: string; mins: number; short: string; state?: undefined }
  | { id: 'music'; kind: 'music'; name: string; playing: boolean; short: string; state?: undefined }
  | { id: 'almanac'; kind: 'habits'; name: string; done: number; total: number; short: string; state?: undefined };

/** what drawGlyph needs; prIcon-free glyphs can be drawn from a bare { kind, state } */
export type GlyphItem = ModuleItem | { kind: 'ci'; state: 'run' | 'fail' | 'ok' };

function eventTime(s: IslandState): number {
  return s.event ? s.t - s.event.start : 0;
}

/** proto: modules */
export function modules(s: IslandState): ModuleItem[] {
  const ev = s.event && s.event.type,
    cs = claudeState(s),
    mins = calMins(s.t);
  const idleShorts: Record<Exclude<ClaudeState, 'work'>, string> = {
    think: 'думает',
    search: 'ищет',
    ask: 'ждёт ответа',
    question: 'спрашивает',
    limit: 'лимит ' + limitLeft(eventTime(s)),
    idle: 'свободен',
  };
  const done = habitsDone(s);
  return [
    {
      id: 'claude',
      kind: 'agent',
      name: 'Claude Code',
      body: MODULE_COL.claude.body,
      seed: 0,
      state: cs,
      short: cs === 'work' ? stepAt(stepIndex(s))[1].toLowerCase() + ' ' + stepAt(stepIndex(s))[2] : idleShorts[cs],
    },
    {
      id: 'github',
      kind: 'ci',
      name: 'GitHub',
      state: ev === 'working' ? 'run' : ev === 'error' ? 'fail' : 'ok',
      short: ev === 'working' ? 'CI идёт' : ev === 'error' ? 'деплой упал' : 'CI зелёный',
    },
    { id: 'cal', kind: 'cal', name: 'Календарь', mins, short: 'созвон через ' + mins + ' мин' },
    {
      id: 'music',
      kind: 'music',
      name: 'Музыка',
      playing: s.musicPlaying,
      short: s.musicPlaying ? (TRACKS[s.trackIdx] as readonly [string, string])[0] : 'пауза',
    },
    {
      id: 'almanac',
      kind: 'habits',
      name: 'Almanac',
      done,
      total: s.habits.length,
      short: 'привычки ' + done + ' из ' + s.habits.length,
    },
  ];
}

/** proto: isHot */
export function isHot(it: ModuleItem): boolean {
  return (
    (it.kind === 'agent' && it.state !== 'idle') ||
    it.state === 'fail' ||
    it.state === 'run' ||
    (it.kind === 'cal' && it.mins <= 5)
  );
}

/** proto: primaryItem */
export function primaryItem(s: IslandState): ModuleItem {
  const m = modules(s);
  return (
    m.find((i) => i.kind === 'agent' && i.state !== 'idle') ||
    m.find((i) => i.kind === 'cal' && i.mins <= 30) ||
    m.find((i) => i.kind === 'music' && i.playing) ||
    (m[4] as ModuleItem)
  );
}

/** proto: idleShort */
export function idleShort(it: ModuleItem): string {
  return it.kind === 'cal'
    ? it.mins + ' мин'
    : it.kind === 'music'
      ? 'играет'
      : it.kind === 'habits'
        ? it.done + '/' + it.total
        : it.short;
}

/** proto: focusTint */
export function focusTint(s: IslandState, f: ModuleId): { c: string; a: number } | null {
  const ev = s.event && s.event.type,
    cs = claudeState(s);
  if (f === 'claude' && cs !== 'idle') return { c: STATE_COL[cs] as string, a: 0.3 };
  if (f === 'github') {
    if (ev === 'error') return { c: '#FF453A', a: 0.45 };
    if (ev === 'success') return { c: '#34C759', a: 0.45 };
    if (ev === 'working') return { c: '#3D8BFF', a: 0.22 };
  }
  if (f === 'cal' && calMins(s.t) <= 5) return { c: '#F5A524', a: 0.35 };
  if (f === 'music' && s.musicPlaying) return { c: '#9EE6B8', a: 0.16 };
  return null;
}

/** proto: ring */
export function ring(
  c: Ctx,
  x: number,
  y: number,
  r: number,
  lw: number,
  frac: number,
  col: string,
  start: number,
): void {
  c.strokeStyle = 'rgba(255,255,255,0.16)';
  c.lineWidth = lw;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.stroke();
  if (frac > 0) {
    c.strokeStyle = col;
    c.beginPath();
    c.arc(x, y, r, start, start + frac * Math.PI * 2);
    c.stroke();
  }
}

/** proto: drawGlyph - a module's small status mark */
export function drawGlyph(s: IslandState, c: Ctx, it: GlyphItem, x: number, y: number, sz: number): void {
  const t = s.t;
  const lw = Math.max(1.3, sz * 0.2);
  if (it.kind === 'agent') {
    drawMini(s, c, x, y, sz, it);
    return;
  }
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const r = sz * 0.85;
  if (it.kind === 'ci') {
    if (it.state === 'run') ring(c, x, y, r, lw, 0.26, '#3D8BFF', t * 5);
    else {
      const fail = it.state === 'fail';
      ring(c, x, y, r, lw, 1, fail ? '#FF453A' : '#34C759', 0);
      if (sz > 6.5) {
        c.lineWidth = lw * 0.9;
        c.beginPath();
        if (fail) {
          const q = r * 0.36;
          c.moveTo(x - q, y - q);
          c.lineTo(x + q, y + q);
          c.moveTo(x + q, y - q);
          c.lineTo(x - q, y + q);
        } else {
          c.moveTo(x - r * 0.42, y + 0.02 * r);
          c.lineTo(x - r * 0.08, y + r * 0.34);
          c.lineTo(x + r * 0.45, y - r * 0.32);
        }
        c.stroke();
      }
    }
  } else if (it.kind === 'cal') {
    ring(c, x, y, r, lw, it.mins / 60, it.mins <= 5 ? '#F5A524' : '#FFFFFF', -Math.PI / 2);
    if (sz > 7.5)
      textAt(c, String(it.mins), x, y + 0.5, { size: Math.round(sz * 0.8), weight: 600, align: 'center', mono: true });
  } else if (it.kind === 'habits') {
    ring(c, x, y, r, lw, it.done / it.total, '#F4A9C6', -Math.PI / 2);
    if (sz > 7.5)
      textAt(c, String(it.done), x, y + 0.5, { size: Math.round(sz * 0.8), weight: 600, align: 'center', mono: true });
  } else {
    const bw = sz * 0.26,
      gap = sz * 0.16,
      n = 4,
      total = n * bw + (n - 1) * gap;
    c.fillStyle = '#FFFFFF';
    for (let i = 0; i < n; i++) {
      const hgt = it.playing ? sz * (0.6 + 0.8 * (0.5 + 0.5 * Math.sin(t * (5 + i * 1.3) + i * 1.7))) : sz * 0.3;
      rrect(c, x - total / 2 + i * (bw + gap), y + sz * 0.65 - hgt, bw, hgt, bw / 2);
      c.fill();
    }
  }
  c.restore();
}

/** proto: prIcon - a pull-request glyph: two commits on a branch merging into a third */
export function prIcon(c: Ctx, x: number, y: number): void {
  c.save();
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = 1.3;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(x - 3.5, y - 4, 1.7, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(x - 3.5, y + 4, 1.7, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(x + 3.5, y + 4, 1.7, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.moveTo(x - 3.5, y - 2.3);
  c.lineTo(x - 3.5, y + 2.3);
  c.stroke();
  c.beginPath();
  c.moveTo(x + 3.5, y + 2.3);
  c.lineTo(x + 3.5, y - 1.5);
  c.quadraticCurveTo(x + 3.5, y - 4, x + 1, y - 4);
  c.lineTo(x - 0.5, y - 4);
  c.stroke();
  c.beginPath();
  c.moveTo(x + 1, y - 5.6);
  c.lineTo(x - 0.6, y - 4);
  c.lineTo(x + 1, y - 2.4);
  c.stroke();
  c.restore();
}
