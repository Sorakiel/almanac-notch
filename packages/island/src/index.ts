// Island renderer: the port of prototype/island-prototype.html (docs/ARCHITECTURE.md).
import { mulberry32, PARITY_SEED, type Rng } from './sim/rng';
import { after, createState, type EventType, type IslandState, type ModuleId, type Tab } from './sim/state';
import type { Settings } from './sim/settings';
import { update } from './sim/behavior';
import { answer, trigger, type Answer } from './sim/events';
import { poke } from './sim/actions';
import { renderStage, stageCursor } from './stage';
import { renderIsland } from './island/render';

export { mulberry32, PARITY_SEED };
export type { Rng, IslandState, EventType, ModuleId, Tab, Settings, Answer };
export * from './sim/settings';
export {
  DEFAULT_THEME,
  type Theme,
  type LayerText,
  type AgentFeed,
  type CalFeed,
  type MediaFeed,
  type HostPrefs,
  type GithubFeed,
  type CiRun,
  type CiNotify,
  type VercelFeed,
  type NotionFeed,
  type GrafanaFeed,
  type AlmanacFeed,
  type MascotEvent,
  type ShelfItem,
  type ShelfKind,
  type StageLook,
} from './sim/state';
export { MODULE_COL } from './island/focus';
export { cardTint } from './island/card';
export { STARS } from './island/cards';
export { MODULE_PROPS, type PropKind } from './mascot/props';
export { EVENTS, EVENT_TYPES, statusOf } from './sim/events';
export { tr, plural, EN, type Lang } from './i18n';
export { update } from './sim/behavior';
export { AUTO_CLOSE, AUTO_CLOSE_DEFAULT, autoCloseFrom, notchState, type NotchState } from './island/focus';
export { renderIsland } from './island/render';
export { islandBack, islandWheel } from './island/depth';
export { SHELF_LIFE, extOf, shelfCarry, shelfDrop, shelfRemove, type ShelfIn } from './island/shelf';
export { MB, NOTCH_W, islandShape, islandTargets, type IslandInputs, type IslandTargets } from './island/geometry';
export {
  islandPointerMove,
  islandPointerLeave,
  islandPointerDown,
  islandPointerUp,
  islandDoubleClick,
  islandContextMenu,
  islandRect,
  hitTest,
  habitTicked,
  type IslandPoint,
} from './island/input';
export {
  renderStage,
  stageCursor,
  stagePointerMove,
  stagePointerDown,
  stageRelease,
  stageDoubleClick,
  type Point,
} from './stage';

export interface MascotOptions {
  settings: Settings;
  /** random source; defaults to mulberry32 with the parity seed */
  rng?: Rng;
  /** real clock at creation, ms (performance.now) */
  now: number;
  /** delay before the launch greeting, s; null skips it */
  greetAfter?: number | null;
}

/**
 * The mascot and the behaviour state. Mirrors the prototype's startup: half-open for 30 s after launch
 * (proto: postLaunchUntil = 35.6) and the greeting after 0.5 s.
 */
export function createMascot(opts: MascotOptions) {
  const s = createState(opts.settings, opts.rng ?? mulberry32(PARITY_SEED), opts.now);
  s.postLaunchUntil = 35.6;
  const greetAfter = opts.greetAfter === undefined ? 0.5 : opts.greetAfter;
  if (greetAfter !== null) after(s, greetAfter, () => trigger(s, 'greeting'));
  return {
    state: s,
    update: (dt: number, now: number) => update(s, dt, now),
    renderStage: (c: CanvasRenderingContext2D, dpr: number) => renderStage(s, c, dpr),
    stageCursor: () => stageCursor(s),
    /** oc: offscreen context of an IW·k × IH·k canvas (k = the drawing scale, 2 in the harness); ic: island canvas; lc: loupe canvas (none in the real window) */
    renderIsland: (ic: CanvasRenderingContext2D, oc: CanvasRenderingContext2D, lc?: CanvasRenderingContext2D) =>
      renderIsland(s, ic, oc, lc),
    trigger: (type: EventType | 'sleep', opts?: { keepView?: boolean }) => trigger(s, type, opts),
    /** n quick pokes at (0.2, -0.3) of the body, as tools/snapshot.mjs does */
    poke: (n: number, lx = 0.2, ly = -0.3) => {
      for (let i = 0; i < n; i++) poke(s, lx, ly);
    },
    answer: (a: Answer) => answer(s, a),
    setFocus: (id: ModuleId | null) => {
      s.focusId = id;
    },
    setTab: (tab: Tab) => {
      s.tab = tab;
    },
  };
}
export type Mascot = ReturnType<typeof createMascot>;
// the island's motion, shared with the settings window (stage 9f): one language of movement
export { LAYER_IN, LAYER_STEP, RISE, TAB_OUT, springK } from './island/reveal';
