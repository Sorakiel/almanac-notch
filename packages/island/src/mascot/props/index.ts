import type { Ctx } from '../../util/draw';
import type { MascotColor } from '../../sim/settings';
import type { Pose } from '../../sim/pose';
import type { IslandState, ModuleId } from '../../sim/state';
import { busyAside, claudeState } from '../../island/focus';
import type { Prop } from './types';
import { headphones } from './headphones';
import { book } from './book';
import { terminal } from './terminal';
import { diff } from './diff';
import { calendar } from './calendar';
import { rocket } from './rocket';
import { pencil } from './pencil';

export type { Prop } from './types';

/**
 * proto: PROPS - a new prop is one entry here.
 */
export const PROPS = { headphones, book, terminal, diff, calendar, rocket, pencil } satisfies Record<string, Prop>;
export type PropKind = keyof typeof PROPS;

/** proto: MODULE_PROPS */
export const MODULE_PROPS: Readonly<Record<ModuleId, PropKind>> = {
  music: 'headphones',
  almanac: 'book',
  claude: 'terminal',
  github: 'diff',
  cal: 'calendar',
  // not in the prototype (docs/CHANGES.md): a rocket - the deploy goes up
  vercel: 'rocket',
  // the prototype's reserved pencil (proto PROPS comment)
  notion: 'pencil',
};

/** proto: propFor - only on the home tab without events; a busy agent shows its work instead */
export function propFor(s: IslandState, f: ModuleId): PropKind | null {
  if ((s.event && !busyAside(s)) || s.tab !== 'home') return null;
  if (f === 'claude' && claudeState(s) !== 'idle') return null;
  if (f === 'music' && !s.musicPlaying) return 'headphones';
  return MODULE_PROPS[f] || null;
}

/** proto: drawProp */
export function drawProp(s: IslandState, c: Ctx, kind: PropKind, P: Pose, mc: MascotColor | null): void {
  const prop: Prop = PROPS[kind];
  c.save();
  c.translate(P.ax, P.ay);
  c.rotate(P.lean);
  c.scale(P.sx, P.sy);
  c.translate(0, -P.b);
  prop.draw(c, P.R, P.b, mc, P, s);
  c.restore();
}
