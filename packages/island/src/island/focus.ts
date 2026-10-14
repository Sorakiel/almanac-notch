// The part of the island's state machine the mascot's behaviour reads. Drawing comes in stage 2b.
import type { IslandState, ModuleId } from '../sim/state';
import type { MascotColor } from '../sim/settings';
import { calMins } from '../stub';

export type NotchState = 'closed' | 'half' | 'open';

/** proto: notchState - the "auto" rules in order */
export function notchState(s: IslandState): NotchState {
  const { S, event, t } = s;
  if (S.nstate !== 'auto') return S.nstate as NotchState;
  if (s.islandHover) return 'open';
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

/** proto: habitsDone */
export function habitsDone(s: IslandState): number {
  return s.habits.filter((h) => h[1]).length;
}

/** proto: autoFocus */
export function autoFocus(s: IslandState): ModuleId {
  const ev = s.event && s.event.type;
  if (ev === 'success' || ev === 'error') return 'github';
  if (claudeState(s) !== 'idle') return 'claude';
  if (calMins(s.t) <= 30) return 'cal';
  if (s.musicPlaying) return 'music';
  return 'almanac';
}

/** proto: effectiveFocus - also records when the shown card changed */
export function effectiveFocus(s: IslandState): ModuleId {
  const f = s.focusId || autoFocus(s);
  if (f !== s.shownFocus) {
    s.shownFocus = f;
    s.focusStart = s.t;
  }
  return f;
}
