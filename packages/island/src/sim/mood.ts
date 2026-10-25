import type { IslandState, Targets } from './state';
import { hop } from './actions';
import { spawnFloat } from './particles';
import { busyAside, callMins, effectiveFocus, habitsDone, notchState } from '../island/focus';
import { PROPS, propFor } from '../mascot/props';
import { ciAlert } from '../island/ci';

/**
 * proto: moduleMood - what the mascot does while a module is in focus and nothing else is going on.
 * Returns the layer text, '' for no mood text, undefined when the layer is off.
 */
export function moduleMood(s: IslandState, T: Targets): string | undefined {
  if (notchState(s) !== 'open' || s.tab !== 'home' || (s.event && !busyAside(s))) return undefined;
  const t = s.t;
  const f = effectiveFocus(s);
  if (f === 'music' && s.musicPlaying) {
    // the dance: the same moves as the celebration, only softer and endless
    T.happy = 1;
    T.lean = Math.sin(t * 6.3) * 0.16;
    T.sq = 1 + 0.07 * Math.sin(t * 12.6);
    if (t > s.nextDanceHop) {
      hop(s, 1.8);
      s.nextDanceHop = t + 1.0;
    }
    if (t > s.nextBit) {
      spawnFloat(s, 'note', '#9EE6B8');
      s.nextBit = t + 0.6;
    }
    return 'танцует под музыку';
  }
  if (f === 'cal' && callMins(s) <= 5) {
    T.wide = 0.5;
    return 'торопит на созвон';
  }
  if (f === 'almanac' && habitsDone(s) === s.habits.length) {
    T.happy = 1;
    return 'гордится';
  }
  // a red CI still waiting: a quiet sulk, softer than the jolt of the failure itself (island/ci.ts)
  if (f === 'github' && ciAlert(s)) {
    T.grump = 0.4;
    T.lid = 0.3;
    T.happy = 0;
    return '';
  }
  const kind = propFor(s, f),
    prop = kind && PROPS[kind];
  if (!prop) return '';
  if (prop.look && !s.islandHover) {
    T.lookX = prop.look[0];
    T.lookY = prop.look[1];
  }
  return prop.mood;
}
