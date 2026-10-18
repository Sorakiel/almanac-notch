import type { IslandState } from './state';
import { TRACKS, TRACK_LEN } from '../stub';

/** proto: nextTrack */
export function nextTrack(s: IslandState): void {
  const n = TRACKS.length;
  s.trackIdx = s.shuffle ? (s.trackIdx + 1 + Math.floor(s.rng() * (n - 1))) % n : (s.trackIdx + 1) % n;
  s.musicPos = 0;
}

/** proto: music clock at the top of update */
export function stepMusic(s: IslandState, dt: number): void {
  // a real player keeps its own clock; the desktop driver sets musicPos every frame
  if (!s.musicPlaying || s.media) return;
  s.musicPos += dt;
  if (s.musicPos >= (TRACK_LEN[s.trackIdx] ?? Infinity)) {
    if (s.repeat) s.musicPos = 0;
    else nextTrack(s);
  }
}
