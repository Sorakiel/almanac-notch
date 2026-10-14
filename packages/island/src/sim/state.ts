import type { Rng } from './rng';
import { createSprings, type Springs } from './springs';
import type { Settings } from './settings';
import { initialHabits } from '../stub';

export type EventType =
  | 'attention'
  | 'question'
  | 'working'
  | 'thinking'
  | 'searching'
  | 'ratelimit'
  | 'success'
  | 'error'
  | 'dance'
  | 'greeting';

export interface MascotEvent {
  type: EventType;
  start: number;
  until: number;
  nextHop: number;
  choice?: number;
  greet?: string;
  label?: string;
  answer?: 'approve' | 'deny' | 'opt';
  answerAt?: number;
}

export interface Particle {
  type: 'bit' | 'note' | 'z';
  color: string | undefined;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  rot: number;
  vr: number;
  size: number;
}

export interface Grab {
  active: boolean;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  vx: number;
  vy: number;
  ox: number;
  oy: number;
  plx: number;
  ply: number;
  tx: number;
  ty: number;
}

/** proto: T - targets rebuilt every frame, layer by layer */
export interface Targets {
  lookX: number;
  lookY: number;
  lid: number;
  happy: number;
  grump: number;
  wide: number;
  hide: number;
  glow: number;
  work: number;
  think: number;
  puff: number;
  lean: number;
  sq: number;
  hand: number;
}

export interface LayerText {
  ev: string;
  ia: string;
  bg: string;
}

/** Colours the stage reads from CSS custom properties. proto: theme / readTheme */
export interface Theme {
  top: string;
  bot: string;
  ground: string;
  muted: string;
  unlit: string;
  shadowA: number;
}
export const DEFAULT_THEME: Theme = {
  top: '#F7F7F6',
  bot: '#E5E7E4',
  ground: '#CFD3CE',
  muted: '#5C6166',
  unlit: 'rgba(20,24,28,0.07)',
  shadowA: 0.16,
};

export type Tab = 'home' | 'chat' | 'add' | 'settings';
export type ModuleId = 'claude' | 'github' | 'cal' | 'music' | 'almanac';

/**
 * Everything the prototype kept in closure-level `let`s. Time only moves in update(dt),
 * randomness only comes from rng.
 */
export interface IslandState {
  S: Settings;
  rng: Rng;
  date: () => Date;
  /** called where the prototype called updateButtons() */
  notify: () => void;

  t: number;
  timers: { at: number; fn: () => void }[];
  ptr: { x: number; y: number; seen: boolean; down: boolean; lastMoveReal: number; speed: number; lastT: number };
  grab: Grab | null;
  pokes: number[];
  grumpyUntil: number;
  hideUntil: number;
  squintUntil: number;
  blinkUntil: number;
  happyUntil: number;
  nextBlink: number;
  overloadUntil: number;
  rebootAt: number;
  prevOverload: boolean;
  postLaunchUntil: number;
  prevHiding: boolean;
  petAccum: number;
  petting: boolean;
  nextBit: number;
  sleeping: boolean;
  forcedSleep: boolean;
  nextZ: number;
  event: MascotEvent | null;
  wander: { x: number; y: number; next: number };
  sqOverride: { val: number; until: number } | null;
  particles: Particle[];
  glowColor: string;
  badgeColor: string;
  prevPosXv: number;
  lastAx: number;
  layerText: LayerText;
  sp: Springs;
  T: Targets;

  /** stage size in CSS px (proto: W, H) */
  W: number;
  H: number;
  theme: Theme;

  // island state the mascot depends on (filled in by the island in stage 2b)
  islandHover: boolean;
  islandPtr: { x: number; y: number } | null;
  islandMascot: { x: number; y: number; R: number } | null;
  focusId: ModuleId | null;
  shownFocus: ModuleId | null;
  focusStart: number;
  tab: Tab;
  musicPlaying: boolean;
  trackIdx: number;
  musicPos: number;
  shuffle: boolean;
  repeat: boolean;
  habits: [string, boolean][];
  nextDanceHop: number;
}

export function createState(S: Settings, rng: Rng, now: number): IslandState {
  return {
    S,
    rng,
    date: () => new Date(),
    notify: () => undefined,
    t: 0,
    timers: [],
    ptr: { x: -1e4, y: -1e4, seen: false, down: false, lastMoveReal: now, speed: 0, lastT: 0 },
    grab: null,
    pokes: [],
    grumpyUntil: 0,
    hideUntil: 0,
    squintUntil: 0,
    blinkUntil: 0,
    happyUntil: 0,
    nextBlink: 1.6,
    overloadUntil: 0,
    rebootAt: -10,
    prevOverload: false,
    postLaunchUntil: 0,
    prevHiding: false,
    petAccum: 0,
    petting: false,
    nextBit: 0,
    sleeping: false,
    forcedSleep: false,
    nextZ: 0,
    event: null,
    wander: { x: 0, y: 0, next: 0 },
    sqOverride: null,
    particles: [],
    glowColor: '#F5A524',
    badgeColor: '#8E8E93',
    prevPosXv: 0,
    lastAx: 0,
    layerText: { ev: '', ia: '', bg: '' },
    sp: createSprings(),
    T: {
      lookX: 0,
      lookY: 0,
      lid: 1,
      happy: 0,
      grump: 0,
      wide: 0,
      hide: 0,
      glow: 0,
      work: 0,
      think: 0,
      puff: 0,
      lean: 0,
      sq: 1,
      hand: 0,
    },
    W: 600,
    H: 400,
    theme: { ...DEFAULT_THEME },
    islandHover: false,
    islandPtr: null,
    islandMascot: null,
    focusId: null,
    shownFocus: null,
    focusStart: -10,
    tab: 'home',
    musicPlaying: true,
    trackIdx: 0,
    musicPos: 42,
    shuffle: true,
    repeat: false,
    habits: initialHabits(),
    nextDanceHop: 0,
  };
}

/** proto: after - run fn once t passes t + d */
export function after(s: IslandState, d: number, fn: () => void): void {
  s.timers.push({ at: s.t + d, fn });
}
