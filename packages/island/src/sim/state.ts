import type { Rng } from './rng';
import { createSprings, type Springs } from './springs';
import type { Settings } from './settings';
import { initialHabits, initialPrefs, type Step } from '../stub';
import type { Lang } from '../i18n';

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
  | 'greeting'
  /** not in the prototype (docs/CHANGES.md): Almanac's evening reminder, habits left today */
  | 'nudge';

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
  /** set by real Claude Code sessions, Vercel, Notion and Grafana: success and error then belong to that card */
  src?: 'agent' | 'vercel' | 'notion' | 'grafana' | 'almanac';
}

/**
 * Live data of a real Claude Code session (stage 4). Null = the prototype's stubs (STEPS,
 * QUESTION, the command, limitLeft), which the harness and the parity frames use.
 */
export interface AgentFeed {
  /** tool calls, oldest first */
  steps: Step[];
  /** s.t when the newest step arrived (slide-in of drawSteps) */
  stepT: number;
  /** the command waiting for approval */
  cmd: string;
  question: readonly [string, readonly string[]] | null;
  /** second line of the searching card */
  search: string;
  /** second line of the thinking card: the prompt or the last step */
  think: string;
  /** plan usage reset, epoch ms; null = no limit hit */
  limitReset: number | null;
  /** plan name for the limit card, e.g. "Pro" */
  plan: string;
  /** last hook from any session, epoch ms */
  lastActive: number | null;
}

/**
 * The next call from the system calendar (stage 5). Null = the prototype's calMins() stub.
 * The desktop driver recomputes it every frame; strings are already short enough for the card.
 */
export interface CalFeed {
  /** minutes to the start, 0 = started; null = no call ahead (title then says why) */
  mins: number | null;
  /** start time, "15:00" or "завтра 10:00" */
  at: string;
  title: string;
  /** third line: "дальше: лекция в 17:10" (or the second line when mins is null) */
  after: string;
}

/**
 * The system's now-playing track (stage 5). Null = the prototype's TRACKS stub. Position,
 * play state, shuffle, repeat and volume live in the usual fields (musicPos, musicPlaying, ...);
 * the island's player buttons queue commands in `out` instead of changing the stub playlist.
 */
export interface MediaFeed {
  /** nothing loaded in any player: the card says so, the rail shows "не играет" */
  idle: boolean;
  title: string;
  /** the title cut for the narrow places (module short text) */
  short: string;
  /** second line: artist · album or player */
  sub: string;
  /** seconds; 0 = unknown (a live stream) */
  len: number;
  /** the real cover; null = the generated one (or the loading tile while artPending) */
  art: CanvasImageSource | null;
  /** a new track whose cover may still come: a neutral tile instead of the generated cover */
  artPending: boolean;
  /** fade-in of a cover that replaced the loading tile, 0..1 */
  artA: number;
  /** palette of the generated cover (index into TRACK_ART) */
  artSeed: number;
  /** "toggle" | "next" | "prev" | "seek <s>" | "shuffle <0|1>" | "repeat <0|1>" | "vol <0..1>" */
  out: string[];
}

/**
 * Live GitHub data (stage 6). Null = the prototype's stubs (harness, parity). With a feed the
 * module shows only real data: CI of the newest default-branch commit, PRs waiting for review,
 * commits of 7 days. Without a token (`auth !== 'ok'`) the card says how to connect.
 */
export interface GithubFeed {
  /** "off" no token, "bad" the token was refused, "ok" data is shown */
  auth: 'off' | 'bad' | 'ok';
  /** CI of the newest commit; "none" = no repository has checks */
  ci: 'run' | 'fail' | 'ok' | 'none';
  /** first card line: "almanac · CI зелёный · 5 из 5" */
  ciText: string;
  /** the rail's and the ears' short text */
  short: string;
  prs: number;
  /** second card line: "2 PR ждут ревью" */
  prText: string;
  /** commits per day, 7 values, today last */
  commits: number[];
  /** the card's two lines while there is nothing to show (no token, no CI) */
  hint: [string, string];
}

/**
 * Live Vercel data (stage 8, not in the prototype). Null = no Vercel module at all (harness,
 * parity): the module exists only in the app. The newest deployment of my projects.
 */
export interface VercelFeed {
  /** "off" no token, "bad" the token was refused, "ok" data is shown */
  auth: 'off' | 'bad' | 'ok';
  /** newest deployment; "none" = no deployments yet */
  state: 'run' | 'fail' | 'ok' | 'none';
  /** the card's rows, newest first (at most three): project, state dot, "2 ч" */
  rows: { id: string; name: string; state: 'run' | 'fail' | 'ok' | 'off'; ago: string }[];
  /** the rail's, chips' and ears' short text */
  short: string;
  /** the card's two lines while there is nothing to show (no token, refused, no deployments) */
  hint: [string, string];
}

/**
 * Live Notion data (stage 8, not in the prototype). Null = no Notion module at all (harness,
 * parity): the module exists only in the app. The pages edited last among those shared with
 * the user's integration.
 */
export interface NotionFeed {
  /** "off" no token, "bad" the token was refused, "ok" data is shown */
  auth: 'off' | 'bad' | 'ok';
  /** the card's rows, newest first (at most three): icon, title, "5 мин" */
  rows: { id: string; title: string; emoji: string | null; ago: string }[];
  /** the rail's, chips' and ears' short text */
  short: string;
  /** the card's two lines while there is nothing to show (no token, refused, no pages) */
  hint: [string, string];
}

/**
 * Live Grafana data (stage 8, not in the prototype). Null = no Grafana module at all (harness,
 * parity): the module exists only in the app. The alert rules firing or pending right now.
 */
export interface GrafanaFeed {
  /** "off" no address or token, "bad" the token was refused, "ok" data is shown */
  auth: 'off' | 'bad' | 'ok';
  /** the worst rule: "fail" something fires, "run" something is pending, "ok" all calm, "none" no rules */
  state: 'fail' | 'run' | 'ok' | 'none';
  /** the card's rows, firing first (at most three): name, "fail" or "run", "12 мин" */
  rows: { id: string; name: string; state: 'fail' | 'run'; ago: string }[];
  /** rules firing or pending in all (the rows show three) */
  total: number;
  /**
   * the dashboard picked in settings: its title (and the panel's), the panel's last value as
   * text, the last hour's points oldest first (empty = nothing to draw), rules on it firing now
   */
  board: { title: string; value: string; points: number[]; firing: number } | null;
  /** the rail's, chips' and ears' short text */
  short: string;
  /** the card's two lines while there are no rows (no token, refused, all calm) */
  hint: [string, string];
}

/**
 * Live Almanac data (stage 8e). Null = the prototype's stub habits (`s.habits`), which the
 * harness and the parity frames use. Today's habits as Almanac counts them: the ones still open
 * first, then the done ones.
 */
export interface AlmanacFeed {
  /** "off" not signed in, "bad" the sign-in expired, "ok" data is shown */
  auth: 'off' | 'bad' | 'ok';
  /** today's habits in card order: id, name, done; "3/8" when a day takes more than one tap */
  rows: { id: string; name: string; done: boolean; progress: string }[];
  /** habits done today, habits counted today */
  done: number;
  total: number;
  /** the rail's, chips' and ears' short text */
  short: string;
  /** the card's two lines while there is nothing to show (not signed in, no habits today) */
  hint: [string, string];
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
export type ModuleId = 'claude' | 'github' | 'cal' | 'music' | 'almanac' | 'vercel' | 'notion' | 'grafana';

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
  /** half-open hold: 30 s after launch, the greeting and (CHANGES 2026-10-14) every open */
  postLaunchUntil: number;
  /** notchState was 'open' on the previous update (auto only) */
  wasOpen: boolean;
  prevHiding: boolean;
  petAccum: number;
  petting: boolean;
  nextBit: number;
  sleeping: boolean;
  forcedSleep: boolean;
  nextZ: number;
  event: MascotEvent | null;
  agent: AgentFeed | null;
  cal: CalFeed | null;
  media: MediaFeed | null;
  github: GithubFeed | null;
  vercel: VercelFeed | null;
  notion: NotionFeed | null;
  grafana: GrafanaFeed | null;
  almanac: AlmanacFeed | null;
  /** requests for the host app, drained by the shell each frame: "settings:" */
  requests: string[];
  /** the host app has a settings window: the settings tab gets a row that opens it */
  settingsLink: boolean;
  /** the app's own settings card (stage 8g, docs/CHANGES.md): its real settings; null = the
   *  prototype's card (harness) */
  host: HostPrefs | null;
  /** the app: the island was opened by a click and stays open until `autoClose` after leaving */
  clickOpen: boolean;
  /** when the pointer last left the island (s.t) */
  hoverLeftAt: number;
  /** modules the user switched off in the app: no chip, rail item, card or mini mascot */
  off: ModuleId[];
  /** the chat tab is switched off: no chat icon in the top bar */
  chatOff: boolean;
  /** top-bar icons: the prototype's outlines, or filled ones (the app, docs/CHANGES.md) */
  iconSet: 'proto' | 'solid';
  /** interface language: the prototype's Russian, or English in the app (src/i18n.ts) */
  lang: Lang;
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
  /** tab transition (docs/CHANGES.md 2026-10-19): the tab we leave and when the switch began */
  prevTab: Tab;
  tabStart: number;
  /** when the open island's content began to reveal (layered, island/reveal.ts) */
  revealStart: number;
  /** the last clicked zone and when, for the press dip (island/hover.ts) */
  pressAct: string;
  pressAt: number;
  /** the open island was drawn on the previous frame */
  drawnOpen: boolean;
  musicPlaying: boolean;
  trackIdx: number;
  musicPos: number;
  shuffle: boolean;
  repeat: boolean;
  habits: [string, boolean][];
  nextDanceHop: number;

  // the island canvas (proto: IW, IH, islandBox, mascotSpots, hits, loupeRect)
  /** island canvas size in CSS px */
  IW: number;
  IH: number;
  /** notch width and menu bar height; the real window passes the system notch (ARCHITECTURE: Mac) */
  notchW: number;
  mb: number;
  /** real window: transparent backdrop, no fake wallpaper, menu bar or loupe */
  bare: boolean;
  islandBox: { x0: number; x1: number; y0: number; y1: number };
  mascotSpots: { x: number; y: number; a: number }[];
  hits: Hit[];
  loupeRect: { x: number; y: number; w: number; h: number };
  muted: boolean;
  volume: number;
  prefs: [string, boolean][];
  /** proto: railK - slide-out progress of each rail chip */
  railK: Record<string, { k: number; last: number }>;
}

/** a clickable zone of the island, rebuilt every frame (proto: hits) */
/** The app's settings card (stage 8g, as coucou's): how the island opens and the statuses. */
export interface HostPrefs {
  /** on: the pointer opens the island (the prototype); off: it only peeks (half), a click opens */
  openOnHover: boolean;
  /** seconds a clicked-open island stays open after the pointer leaves */
  autoClose: number;
  /** connection dots in the card's footer: Claude Code and the switched-on services */
  status: { name: string; state: 'ok' | 'bad' | 'off' }[];
  version: string;
  /** sound volume 0..1 (stage 9a); on/off is `muted`, shared with the top bar's speaker */
  volume: number;
  /** the volume slider is being dragged: its track, island px */
  volDrag?: { bx0: number; bx1: number } | null;
}

export interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  act: string;
  cx?: number;
  cy?: number;
  R?: number;
  bx0?: number;
  bx1?: number;
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
    wasOpen: false,
    prevHiding: false,
    petAccum: 0,
    petting: false,
    nextBit: 0,
    sleeping: false,
    forcedSleep: false,
    nextZ: 0,
    event: null,
    agent: null,
    cal: null,
    media: null,
    github: null,
    vercel: null,
    notion: null,
    grafana: null,
    almanac: null,
    requests: [],
    settingsLink: false,
    host: null,
    clickOpen: false,
    hoverLeftAt: 0,
    off: [],
    chatOff: false,
    iconSet: 'proto',
    lang: 'ru',
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
    prevTab: 'home',
    tabStart: -10,
    revealStart: -10,
    pressAct: '',
    pressAt: -10,
    drawnOpen: false,
    musicPlaying: true,
    trackIdx: 0,
    musicPos: 42,
    shuffle: true,
    repeat: false,
    habits: initialHabits(),
    nextDanceHop: 0,
    IW: 560,
    IH: 120,
    notchW: 190,
    mb: 32,
    bare: false,
    islandBox: { x0: 0, x1: 0, y0: 0, y1: 0 },
    mascotSpots: [],
    hits: [],
    loupeRect: { x: 0, y: 0, w: 84, h: 40 },
    muted: false,
    volume: 0.6,
    prefs: initialPrefs(),
    railK: {},
  };
}

/** proto: after - run fn once t passes t + d */
export function after(s: IslandState, d: number, fn: () => void): void {
  s.timers.push({ at: s.t + d, fn });
}
