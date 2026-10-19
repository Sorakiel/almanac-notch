// The part of the island's state machine the mascot's behaviour reads. Drawing comes in stage 2b.
import { tr } from '../i18n';
import type { IslandState, ModuleId } from '../sim/state';
import type { MascotColor } from '../sim/settings';
import { calMins } from '../stub';
import { startFlight } from './flight';

export type NotchState = 'closed' | 'half' | 'open';

/** proto: notchState - the "auto" rules in order */
export function notchState(s: IslandState): NotchState {
  const { S, event, t } = s;
  if (S.nstate !== 'auto') return S.nstate as NotchState;
  // the app's "open on hover" and auto-close (stage 8g, docs/CHANGES.md); the harness has no host
  // and keeps the prototype's rule: hover opens, leaving closes
  if (s.host) {
    if (s.islandHover) return s.host.openOnHover || s.clickOpen ? 'open' : 'half';
    if (s.clickOpen && t - s.hoverLeftAt < s.host.autoClose) return 'open';
    // a pointer that slips off for a moment does not slam the island shut: it closes 0.6 s after
    // the pointer left, as coucou's (2026-10-19)
    if (s.host.openOnHover && s.hoverLeftAt > 0 && t - s.hoverLeftAt < 0.6) return 'open';
  } else if (s.islandHover) return 'open';
  if (event && (event.type === 'attention' || event.type === 'question' || event.type === 'greeting')) return 'open';
  if (s.overloadUntil > t || s.sp.alertA.x > 0.15) return 'open';
  if (event || (s.grab && s.grab.active) || s.grumpyUntil > t || s.hideUntil > t || s.petting) return 'half';
  if (t < s.postLaunchUntil) return 'half'; // stays half-open for 30 s after launch
  return 'closed';
}

/** proto: MODULE_COL - the mascot recoloured for each module card */
export const MODULE_COL: Readonly<Record<ModuleId, MascotColor>> = {
  claude: { body: '#F0B08A', shade: '#C27A52', eye: '#16171A' },
  github: { body: '#B8C2FF', shade: '#7D88D6', eye: '#16171A' },
  cal: { body: '#FFD27A', shade: '#D6A23E', eye: '#16171A' },
  music: { body: '#9EE6B8', shade: '#5DB884', eye: '#16171A' },
  almanac: { body: '#F4A9C6', shade: '#C9708F', eye: '#16171A' },
  // not in the prototype (docs/CHANGES.md): grey-lilac, the owner's pick
  vercel: { body: '#C9C3E8', shade: '#918AC0', eye: '#16171A' },
  // not in the prototype (docs/CHANGES.md): paper grey, like a Notion page
  notion: { body: '#E4DFD3', shade: '#ACA594', eye: '#16171A' },
  // not in the prototype (docs/CHANGES.md): between orange and red, the owner's pick
  grafana: { body: '#FF8C66', shade: '#CC5A3A', eye: '#16171A' },
};

export type ClaudeState = 'work' | 'think' | 'search' | 'ask' | 'question' | 'limit' | 'idle';

/** proto: claudeState */
export function claudeState(s: IslandState): ClaudeState {
  const ev = s.event && s.event.type;
  const map: Partial<Record<string, ClaudeState>> = {
    working: 'work',
    thinking: 'think',
    searching: 'search',
    attention: 'ask',
    question: 'question',
    ratelimit: 'limit',
  };
  return (ev && map[ev]) || 'idle';
}

/** proto: calMins, or the live calendar when there is one (Infinity = no call ahead) */
export function callMins(s: IslandState): number {
  return s.cal ? (s.cal.mins ?? Infinity) : calMins(s.t);
}

/** "14 мин", "2 ч", "2 ч 5 мин": the live calendar can be hours away (the stub never is) */
export function minsText(s: IslandState, m: number): string {
  if (m < 60) return tr(s, '{0} мин', m);
  const h = Math.floor(m / 60),
    r = m % 60;
  return r ? tr(s, '{0} ч {1} мин', h, r) : tr(s, '{0} ч', h);
}

/** proto: habitsDone - or today's live Almanac count */
export function habitsDone(s: IslandState): number {
  return s.almanac ? s.almanac.done : s.habits.filter((h) => h[1]).length;
}

/** Habits counted today: the stub's list, or the live Almanac day. */
export function habitsTotal(s: IslandState): number {
  return s.almanac ? s.almanac.total : s.habits.length;
}

/** proto: autoFocus */
export function autoFocus(s: IslandState): ModuleId {
  const ev = s.event && s.event.type,
    on = (id: ModuleId): boolean => hasModule(s, id);
  // a real Claude Code session finishing or failing belongs to its own card
  if ((ev === 'success' || ev === 'error') && s.event && s.event.src === 'agent' && on('claude')) return 'claude';
  if ((ev === 'success' || ev === 'error') && s.event && s.event.src === 'vercel' && on('vercel')) return 'vercel';
  if (ev === 'success' && s.event && s.event.src === 'notion' && on('notion')) return 'notion';
  if ((ev === 'success' || ev === 'error') && s.event && s.event.src === 'grafana' && on('grafana')) return 'grafana';
  if ((ev === 'success' || ev === 'nudge' || ev === 'dance') && s.event && s.event.src === 'almanac' && on('almanac'))
    return 'almanac';
  if ((ev === 'success' || ev === 'error') && on('github')) return 'github';
  if (claudeState(s) !== 'idle' && on('claude')) return 'claude';
  if (callMins(s) <= 30 && on('cal')) return 'cal';
  if (s.musicPlaying && on('music')) return 'music';
  // switched-off modules (the app): the first one left
  return FALLBACK.find(on) ?? 'almanac';
}

/** the rest card when nothing is going on; the app keeps at least one module on */
const FALLBACK: ModuleId[] = ['almanac', 'claude', 'cal', 'music', 'github', 'vercel', 'notion', 'grafana'];

/** The module is shown: not switched off, and Vercel, Notion and Grafana only where the app feeds them (not in the prototype). */
export function hasModule(s: IslandState, id: ModuleId): boolean {
  if (s.off.includes(id)) return false;
  if (id === 'vercel') return s.vercel !== null;
  if (id === 'notion') return s.notion !== null;
  if (id === 'grafana') return s.grafana !== null;
  return true;
}

/**
 * Not in the prototype (docs/CHANGES.md): a busy Claude (working, thinking, searching) stays on its
 * own card, the rail and the ears. While another module's card is open, the mascot there keeps
 * that module's mood and prop (dances to the music) instead of showing Claude's work.
 */
export function busyAside(s: IslandState): boolean {
  const ev = s.event && s.event.type;
  return (
    (ev === 'working' || ev === 'thinking' || ev === 'searching') &&
    s.tab === 'home' &&
    notchState(s) === 'open' &&
    effectiveFocus(s) !== 'claude'
  );
}

/** proto: effectiveFocus - also records when the shown card changed */
export function effectiveFocus(s: IslandState): ModuleId {
  const f = (s.focusId && hasModule(s, s.focusId) && s.focusId) || autoFocus(s);
  if (f !== s.shownFocus) {
    s.prevFocus = s.shownFocus;
    s.shownFocus = f;
    s.focusStart = s.t;
    startFlight(s);
  }
  return f;
}
