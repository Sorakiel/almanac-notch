// Pointer input on the island canvas, without DOM listeners. Points are in island CSS px (proto: islandPoint).
import { clamp } from '../util/math';
import type { Hit, IslandState, MediaFeed } from '../sim/state';
import { hop, poke, wake } from '../sim/actions';
import { answer, trigger, type Answer } from '../sim/events';
import { nextTrack } from '../sim/music';
import { TRACKS, TRACK_LEN } from '../stub';
import type { ModuleId, Tab } from '../sim/state';
import { habitsDone, habitsTotal } from './focus';
import { hitAt } from './hits';

export interface IslandPoint {
  x: number;
  y: number;
}

/** proto: island pointermove - returns the cursor for the island canvas; now in ms */
export function islandPointerMove(s: IslandState, p: IslandPoint, now: number): string {
  const B = s.islandBox;
  s.islandPtr = p;
  s.islandHover = p.x > B.x0 - 10 && p.x < B.x1 + 10 && p.y < B.y1 + 10;
  const cursor = hitAt(s, p) ? 'pointer' : 'default';
  s.ptr.lastMoveReal = now;
  s.ptr.seen = true;
  if (s.sleeping && !s.forcedSleep) wake(s, true);
  return cursor;
}

/** proto: island pointerleave */
export function islandPointerLeave(s: IslandState): void {
  s.islandHover = false;
  s.islandPtr = null;
}

/**
 * proto: the habit checkbox's feedback (island pointerdown) - the last one of the day starts the
 * celebration, any other tick a short happy hop. Also used for live Almanac rows.
 */
export function habitTicked(s: IslandState, checked: boolean, src?: 'almanac'): void {
  if (checked && habitsDone(s) === habitsTotal(s)) {
    const keep = s.focusId;
    trigger(s, 'dance');
    if (s.event) {
      s.event.label = 'Все привычки выполнены';
      if (src) s.event.src = src;
    }
    s.focusId = keep;
  } else if (checked) {
    s.happyUntil = s.t + 0.8;
    hop(s, 3);
  }
}

/** proto: island pointerdown */
export function islandPointerDown(s: IslandState, p: IslandPoint): void {
  const h = hitAt(s, p);
  if (!h) return;
  const act = h.act;
  if (act === 'mascot') {
    const R = h.R ?? 1;
    poke(s, clamp((p.x - (h.cx ?? 0)) / R, -1, 1), clamp((p.y - (h.cy ?? 0)) / (R * 0.92), -1, 1));
  } else if (act.startsWith('focus:')) s.focusId = act.slice(6) as ModuleId;
  else if (act === 'approve' || act === 'deny' || act.startsWith('opt:')) answer(s, act as Answer);
  else if (act.startsWith('tab:'))
    s.tab = act.slice(4) === s.tab && s.tab === 'settings' ? 'home' : (act.slice(4) as Tab);
  else if (act === 'mute') s.muted = !s.muted;
  // not in the prototype (docs/CHANGES.md): a live habit row - the app marks it in Almanac and
  // answers with the same feedback as the stub's checkbox (src/feeds.ts AlmanacDriver)
  else if (act.startsWith('almanac:')) s.requests.push(act);
  else if (act.startsWith('habit:')) {
    const hb = s.habits[+act.slice(6)];
    if (!hb) return;
    hb[1] = !hb[1];
    habitTicked(s, hb[1]);
  } else if (act === 'open:settings') s.requests.push('settings:');
  // not in the prototype: the Vercel card's arrow opens the deployment on vercel.com (the app)
  else if (act.startsWith('vercel:')) s.requests.push(act);
  // not in the prototype: a Notion card row opens the page (the app)
  else if (act.startsWith('notion:')) s.requests.push(act);
  // not in the prototype: the Grafana card opens the alert list or the picked dashboard (the app)
  else if (act.startsWith('grafana:')) s.requests.push(act);
  else if (act.startsWith('pref:')) {
    const pr = s.prefs[+act.slice(5)];
    if (pr) pr[1] = !pr[1];
  } else if (act.startsWith('m:') && s.media) mediaAct(s, act, h, p);
  else if (act === 'm:toggle') s.musicPlaying = !s.musicPlaying;
  else if (act === 'm:next') nextTrack(s);
  else if (act === 'm:prev') {
    if (s.musicPos > 3) s.musicPos = 0;
    else {
      s.trackIdx = (s.trackIdx + TRACKS.length - 1) % TRACKS.length;
      s.musicPos = 0;
    }
  } else if (act === 'm:shuffle') s.shuffle = !s.shuffle;
  else if (act === 'm:repeat') s.repeat = !s.repeat;
  else if (act === 'm:seek')
    s.musicPos = clamp((p.x - (h.bx0 ?? 0)) / ((h.bx1 ?? 1) - (h.bx0 ?? 0)), 0, 1) * (TRACK_LEN[s.trackIdx] ?? 0);
  else if (act === 'm:vol') s.volume = clamp((p.x - (h.bx0 ?? 0)) / ((h.bx1 ?? 1) - (h.bx0 ?? 0)), 0, 1);
}

/** The player buttons with a real player: same look, but the commands go to the driver. */
function mediaAct(s: IslandState, act: string, h: Hit, p: IslandPoint): void {
  const md = s.media as MediaFeed,
    frac = clamp((p.x - (h.bx0 ?? 0)) / ((h.bx1 ?? 1) - (h.bx0 ?? 0)), 0, 1);
  if (act === 'm:toggle') {
    s.musicPlaying = !s.musicPlaying;
    md.out.push('toggle');
  } else if (act === 'm:next') {
    s.musicPos = 0;
    md.out.push('next');
  } else if (act === 'm:prev') {
    // as in the prototype: past 3 s "previous" restarts the track
    if (s.musicPos > 3) md.out.push('seek 0');
    else md.out.push('prev');
    s.musicPos = 0;
  } else if (act === 'm:shuffle') {
    s.shuffle = !s.shuffle;
    md.out.push('shuffle ' + (s.shuffle ? 1 : 0));
  } else if (act === 'm:repeat') {
    s.repeat = !s.repeat;
    md.out.push('repeat ' + (s.repeat ? 1 : 0));
  } else if (act === 'm:seek' && md.len > 0) {
    s.musicPos = frac * md.len;
    md.out.push('seek ' + s.musicPos.toFixed(1));
  } else if (act === 'm:vol') {
    s.volume = frac;
    md.out.push('vol ' + frac.toFixed(3));
  }
}

/** proto: island dblclick - joy from the island's mascot (no burst, unlike the stage) */
export function islandDoubleClick(s: IslandState, p: IslandPoint): void {
  const h = hitAt(s, p);
  if (h && h.act === 'mascot') {
    s.pokes = [];
    s.grumpyUntil = 0;
    s.hideUntil = 0;
    s.happyUntil = s.t + 1.1;
    hop(s, 5.6);
  }
}

/** The black strip as drawn on the last frame, island CSS px. The window takes clicks only here and on hits. */
export function islandRect(s: IslandState): { x: number; y: number; w: number; h: number } {
  const B = s.islandBox;
  return { x: B.x0, y: B.y0, w: B.x1 - B.x0, h: B.y1 - B.y0 };
}

/** Action of the topmost clickable zone under the point (proto: hitAt), or null. */
export function hitTest(s: IslandState, p: IslandPoint): string | null {
  const h = hitAt(s, p);
  return h ? h.act : null;
}
