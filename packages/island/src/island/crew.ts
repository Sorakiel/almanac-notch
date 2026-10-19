// The idle "crew": tiny mascots of the modules in the right ear (docs/SPEC.md 2.3).
import { hexA } from '../util/math';
import { rrect, type Ctx } from '../util/draw';
import type { IslandState, ModuleId } from '../sim/state';
import { bodyPath } from '../mascot/shape';
import { MODULE_COL, callMins, claudeState, hasModule, type ClaudeState } from './focus';

export type MiniState = ClaudeState | 'fail';

export interface MiniItem {
  body: string;
  seed: number;
  state: MiniState | string;
  /** when set, the body is shaded light to dark like the big mascot: depth instead of a flat disc */
  shade?: string;
}

/** proto: STATE_COL */
export const STATE_COL: Readonly<Record<string, string>> = {
  fail: '#FF453A',
  work: '#3D8BFF',
  think: '#A07CFF',
  ask: '#F5A524',
  search: '#38BDF8',
  question: '#22C3E6',
  limit: '#8E8E93',
};

/** proto: miniCrew */
export function miniCrew(s: IslandState): (MiniItem & { id: ModuleId })[] {
  const ev = s.event && s.event.type;
  const all: (MiniItem & { id: ModuleId })[] = [
    { id: 'claude', body: MODULE_COL.claude.body, seed: 0, state: claudeState(s) },
    {
      id: 'github',
      body: MODULE_COL.github.body,
      seed: 1,
      state: (s.github ? s.github.auth === 'ok' && s.github.ci === 'fail' : ev === 'error') ? 'fail' : 'idle',
    },
    { id: 'cal', body: MODULE_COL.cal.body, seed: 2, state: callMins(s) <= 5 ? 'ask' : 'idle' },
    { id: 'music', body: MODULE_COL.music.body, seed: 3, state: 'idle' },
  ];
  // not in the prototype (docs/CHANGES.md): Vercel, only where the app feeds it
  if (s.vercel)
    all.push({
      id: 'vercel',
      body: MODULE_COL.vercel.body,
      seed: 4,
      state: s.vercel.auth === 'ok' && s.vercel.state === 'fail' ? 'fail' : s.vercel.state === 'run' ? 'work' : 'idle',
    });
  if (s.notion) all.push({ id: 'notion', body: MODULE_COL.notion.body, seed: 5, state: 'idle' });
  if (s.grafana)
    all.push({
      id: 'grafana',
      body: MODULE_COL.grafana.body,
      seed: 6,
      state:
        s.grafana.auth !== 'ok'
          ? 'idle'
          : s.grafana.state === 'fail'
            ? 'fail'
            : s.grafana.state === 'run'
              ? 'ask'
              : 'idle',
    });
  // the ear holds a 2 × 2 crew: with a stage 8 module on, the first four of those switched on
  return s.off.length || s.vercel || s.notion || s.grafana ? all.filter((m) => hasModule(s, m.id)).slice(0, 4) : all;
}

/** proto: drawMini - a tiny flat mascot with its state as a dot */
export function drawMini(s: IslandState, c: Ctx, x: number, cy: number, R: number, it: MiniItem): void {
  const t = s.t;
  const b = R * 0.92,
    st = it.state;
  const blink = (t + it.seed * 1.7) % 4.1 < 0.12;
  let lx = -0.6,
    ly = 0.05,
    open = 1,
    bob = 0;
  if (st === 'work') {
    lx = 0.45;
    ly = 0.45;
    bob = Math.sin(t * 7 + it.seed) * R * 0.08;
  } else if (st === 'think') {
    lx = -0.4;
    ly = -0.6;
    open = 0.75;
  } else if (st === 'ask' || st === 'question') {
    lx = 0;
    ly = st === 'question' ? -0.3 : 0;
    open = 1.15;
    bob = -Math.abs(Math.sin(t * 4)) * R * 0.18;
  } else if (st === 'search') {
    lx = Math.sin(t * 3.2) * 0.7;
    ly = 0.15;
  } else if (st === 'limit') {
    ly = 0.3;
    open = 0.45;
  } else if ((t * 0.37 + it.seed) % 3 < 0.6) {
    lx = 0.5;
  }
  if (blink) open = 0.1;
  c.save();
  c.translate(x, cy + bob);
  bodyPath(c, R, b);
  c.fillStyle = it.body;
  c.fill();
  if (it.shade) {
    c.save();
    bodyPath(c, R, b);
    c.clip();
    const g = c.createLinearGradient(0, -b, 0, b);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.42, hexA(it.shade, 0));
    g.addColorStop(1, hexA(it.shade, 0.85));
    c.fillStyle = g;
    c.fillRect(-R * 1.3, -b * 1.3, R * 2.6, b * 2.6);
    c.restore();
  }
  const ew = R * 0.24,
    eh = Math.max(R * 0.07, R * 0.5 * open);
  c.fillStyle = '#16171A';
  for (const side of [-1, 1]) {
    const ex = lx * R * 0.18 + side * R * 0.27,
      ey = ly * b * 0.22 - b * 0.04;
    rrect(c, ex - ew / 2, ey - eh / 2, ew, eh, Math.min(ew, eh) / 2);
    c.fill();
  }
  c.restore();
  const col = STATE_COL[st];
  if (col) {
    const r = Math.max(2, R * 0.28) * (st === 'ask' ? 1 + 0.2 * Math.sin(t * 7) : 1);
    c.fillStyle = '#000';
    c.beginPath();
    c.arc(x + R * 0.72, cy + b * 0.6, r + 1.3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = col;
    c.beginPath();
    c.arc(x + R * 0.72, cy + b * 0.6, r, 0, Math.PI * 2);
    c.fill();
  }
}
