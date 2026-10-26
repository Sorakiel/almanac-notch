// The settings window comes out of the island and pulls away from it like oil (owner, 2026-10-26):
// the island pushes out a body, the body pulls down to where the window will be, and between them
// a web of threads stretches - leaning both ways, forked, bridged - and lets go one thread at a
// time, the web rearranging after every snap. Keyframed and solved, not simulated: the same t
// always gives the same frame, and every shape is a number in a table.
//
// Everything is one signed-distance field: the island (with its concave shoulders at the top
// edge), the body and the web are joined with a smooth minimum, so the fillets where a thread
// holds on are the field itself. The material is the island's: matte black with a hairline of
// light - no gloss (owner).
//
// One scene, two players: design/goo.html films it over a wallpaper with a frame of the window,
// opening.html plays it in the app on a transparent click-through overlay, where the real
// settings window takes the body's place at SHOW_AT.
import { springK } from '@almanac-notch/island';

/** where the scene is drawn, all in CSS px of the drawing surface (y down from the screen top) */
export interface OpeningGeo {
  w: number;
  h: number;
  /** the island's middle and its closed size (the strip under the notch) */
  cx: number;
  /** open: the settings were asked for from the open island - the body comes out of its lower
   *  edge and the island keeps its shape (it is drawn over the scene); closed: from the tray - the
   *  closed strip gathers itself first. r: its lower corners */
  island: { w: number; h: number; r: number; open: boolean };
  /** the settings window: left, top, size, corner radius */
  win: { x: number; y: number; w: number; h: number; r: number };
}

/** when the real window takes the body's place (the content shows from here), and the end, s */
export const SHOW_AT = 0.66;
export const END = 1.2;

let W = 1710,
  H = 1107,
  CX = W / 2,
  I0 = { w: 250, h: 33.5, r: 13, open: false },
  WIN = { x: CX - 360, y: (H - 520) / 2, w: 720, h: 520, r: 22 },
  WCY = WIN.y + WIN.h / 2,
  WCX = WIN.x + WIN.w / 2;

export function configure(g: OpeningGeo): void {
  W = g.w;
  H = g.h;
  CX = g.cx;
  I0 = { ...g.island };
  WIN = { ...g.win };
  WCY = WIN.y + WIN.h / 2;
  WCX = WIN.x + WIN.w / 2;
  EYE_HOME = eyeHome();
  cache = null;
}

const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
const k01 = (t: number, a: number, b: number): number => clamp((t - a) / (b - a));
const easeOut = (k: number): number => 1 - (1 - k) ** 3;
const easeIn = (k: number): number => k * k * k;
const easeInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

interface Edge {
  a: [number, number];
  b: [number, number];
  c: [number, number]; // the curve's control point: the middle lags behind its ends
  r: number; // radius now
  pinch: number; // where along it it pinches, 0..1
  depth: number; // how pinched, 0..1
  gap: number; // after the snap: how far the halves have drawn back, 0..1 (the further one)
  gaps: [number, number]; // the half at a, the half at b
  feet: [number, number]; // how wide each end flares: a cone at a surface, a little at a knot
  wave: [number, number]; // the writhe: amplitude px, phase
}

interface Frame {
  island: [number, number]; // w, h
  body: [number, number, number, number]; // cy, half w, half h, corner
  bx: number; // the body's middle
  edges: Edge[];
  nodes: [number, number, number][]; // the junctions as blobs: x, y, r
  eyes: [number, number, number, number, number, number]; // x, y, half spacing, alpha, half w, half h
  open: number; // 0 a blob of the island → 1 the window (softens the joins)
  web: number; // how much the threads still melt into one sheet: 1 at first, 0 once stretched
  content: number;
}

/** where the header's mascot of the Island page has its eyes in the window (measured: its 150 x 120
 *  canvas at 518, 44; R = 46 * 0.58; eyes just above the body's middle) */
const eyeHome = () => ({ x: WIN.x + 593, y: WIN.y + 104, half: 8, w: 2.6, h: 5.2 });
let EYE_HOME = eyeHome();

// The threads are a web, not a row of rods (owner's sketch, 2026-10-26): they hold on at different
// places above and below, so they lean both ways; some fork into two feet, some are bridged to a
// neighbour, one stands on a small triangle. The web is a graph: anchors on the island and on the
// window, junctions in the air, edges between them. A junction sits where the pulls of its threads
// balance (each thread pulls with its own strength) and follows that place on a spring, so when a
// thread snaps the web rearranges - forks close, bridged threads straighten, a junction left with
// one thread is drawn into the surface it hangs from. That is where the sideways motion comes from.

/** anchors: px from the middle, measured at the gathered island (half width 170) and the full
 *  window (half width 360); they ride the surfaces as those widen */
const ISL = { I0: -160, I1: -128, I2: -104, I3: -78, I4: -40, I7: 52, I8: 84, I9: 118, I10: 146, I11: 164 };
const BOT = {
  B0: -330,
  B1: -262,
  B2: -205,
  B3: -150,
  B4: -110,
  B5: -84,
  B6: -28,
  B7: 40,
  B8: 98,
  B10: 222,
  B11: 282,
  B12: 330,
};
type Anchor = keyof typeof ISL | keyof typeof BOT;
const JUNCTIONS = ['Ja', 'Jb', 'Jc', 'Jd', 'Je', 'Jf'] as const;
type Junction = (typeof JUNCTIONS)[number];
type NodeId = Anchor | Junction;

/** r: radius at rest; pull: how hard it pulls its junctions; snap: when it lets go, s; pinch: where;
 *  bow: a little curl of its own, so no two are alike. A junction left with one thread lets that go
 *  right after, all of it drawn back into its anchor (pinch at the junction's end): a stub never
 *  hangs under a surface and no drop is left in the air. It goes at least 0.08 s after the others
 *  at its junction: their halves have drawn back into the junction by then (see halfGap).
 *
 *  Stretched slime between two plates is a few thick threads among many thin ones, and the thin
 *  ones go first - so three thick (r 7-8) carry the shape, medium ones (4-5) fork and bridge, and
 *  hairlines (2) fill the gaps and snap in the first tenth of a second. Thick threads lean left,
 *  the right side leans right: the web opens like a fan from the narrow island to the wide window.
 *  No two threads cross - liquid that touches merges, so a crossing is drawn as a knot (Jf). */
const EDGES: { a: NodeId; b: NodeId; r: number; pull: number; snap: number; pinch: number; bow: number }[] = [
  // far left: a hairline and a medium thread forking into two feet by the window
  { a: 'I0', b: 'B0', r: 2, pull: 1, snap: 0.39, pinch: 0.6, bow: -0.07 },
  { a: 'I1', b: 'Ja', r: 4.5, pull: 1, snap: 0.62, pinch: 0.45, bow: -0.04 },
  { a: 'Ja', b: 'B1', r: 3, pull: 2.5, snap: 0.46, pinch: 0.5, bow: 0 },
  { a: 'Ja', b: 'B2', r: 3.5, pull: 2.5, snap: 0.72, pinch: 0, bow: 0 },
  { a: 'I2', b: 'B3', r: 1.8, pull: 1, snap: 0.37, pinch: 0.4, bow: 0.05 },
  // thick, forked at the island, leaning left
  { a: 'I3', b: 'Jb', r: 4, pull: 3, snap: 0.58, pinch: 0.5, bow: 0 },
  { a: 'I4', b: 'Jb', r: 4.5, pull: 3, snap: 0.76, pinch: 1, bow: 0 },
  { a: 'Jb', b: 'B4', r: 7, pull: 1, snap: 0.66, pinch: 0.42, bow: 0.04 },
  // the long one, standing on a triangle by the window, bridged to the right: it holds longest
  { a: 'I7', b: 'Jc', r: 8, pull: 1, snap: 0.86, pinch: 1, bow: 0.03 },
  { a: 'Jc', b: 'Jd', r: 7.5, pull: 1, snap: 0.74, pinch: 0.55, bow: -0.04 },
  { a: 'Jd', b: 'B5', r: 3.5, pull: 2.5, snap: 0.52, pinch: 0.45, bow: 0 },
  { a: 'Jd', b: 'B6', r: 5, pull: 2.5, snap: 0.86, pinch: 0, bow: 0 },
  // the bridge, and a thin thread that ran into it and became a knot
  { a: 'Jc', b: 'Jf', r: 3, pull: 0.8, snap: 0.55, pinch: 0.5, bow: 0.06 },
  { a: 'Jf', b: 'Je', r: 3, pull: 0.8, snap: 0.65, pinch: 0, bow: 0.04 },
  { a: 'I8', b: 'Jf', r: 2.2, pull: 1, snap: 0.48, pinch: 0.5, bow: 0 },
  { a: 'Jf', b: 'B7', r: 2.4, pull: 1, snap: 0.44, pinch: 0.55, bow: -0.05 },
  // thick on the right, leaning right, on two feet
  { a: 'I9', b: 'Je', r: 6.5, pull: 1, snap: 0.8, pinch: 1, bow: 0.03 },
  { a: 'Je', b: 'B10', r: 6.5, pull: 1, snap: 0.7, pinch: 0.4, bow: 0.05 },
  { a: 'Je', b: 'B8', r: 3, pull: 1.5, snap: 0.6, pinch: 0.5, bow: -0.04 },
  // far right: a hairline and a medium thread curling out to the window's corner
  { a: 'I10', b: 'B11', r: 2, pull: 1, snap: 0.41, pinch: 0.55, bow: 0.08 },
  { a: 'I11', b: 'B12', r: 3.2, pull: 1, snap: 0.5, pinch: 0.6, bow: 0.1 },
];

/** when a junction lets go of its last thread: a half drawing back into a junction has to be home
 *  by then, or it is left as a drop in the air */
const deathOf = (j: NodeId): number => Math.max(...EDGES.filter((e) => e.a === j || e.b === j).map((e) => e.snap));
/** how far the half of a snapped edge at its end `end` has drawn back: 0.2 s into a surface,
 *  quicker into a junction that is about to go */
function halfGap(e: (typeof EDGES)[number], end: NodeId, t: number): number {
  // the owner's reference is a symbiote, not slime: a snapped tendril does not hang as a drop, it
  // whips back - fast at first, then home
  const dur = (JUNCTIONS as readonly string[]).includes(end) ? clamp(deathOf(end) - e.snap, 0.06, 0.2) : 0.26;
  const k = k01(t, e.snap, e.snap + dur);
  return t < e.snap ? 0 : 1 - (1 - k) ** 5;
}

/** in the footage a strand stands on a cone as wide as its hold, an hourglass narrowing to the
 *  middle; at a knot the threads meet without one */
const footOf = (id: NodeId): number => ((JUNCTIONS as readonly string[]).includes(id) ? 0.3 : 1.6);

/** the bodies' shapes over time - pure functions of t, the web is solved on top of them */
function bodiesAt(t: number) {
  // 1. the island gathers itself (0 - 0.2) and, once the last thread lets go, settles on a spring
  const swell = easeOut(k01(t, 0, 0.2));
  const settle = springK(Math.max(0, t - 0.86), 0.4, 0.42);
  // the open island is drawn by its own window over the scene: it must not grow out from under it
  const gather = I0.open ? 0 : Math.max(-0.15, swell * (1 - settle));
  const iw = mix(I0.w, I0.w + 90, gather),
    ih = mix(I0.h, I0.h + 26, gather);
  // 2. the window's body: pushed out of the island (0.04 - 0.22), then it pulls away, slowly and
  // heavily, as something viscous does, and grows into the window on the island's spring
  const out = easeOut(k01(t, 0.04, 0.24));
  const away = springK(Math.max(0, t - 0.2), 0.62, 0.78);
  const grow = springK(Math.max(0, t - 0.26), 0.58, 0.66);
  const hw = mix(mix(iw * 0.36, 150, out), WIN.w / 2, grow),
    hh = mix(mix(8, 40, out), WIN.h / 2, grow);
  const cy = mix(mix(ih * 0.4, ih + 44, out), WCY, away);
  // the window need not sit right under the island (another screen size, a moved window)
  const bx = mix(CX, WCX, away);
  return { t, iw, ih, hw, hh, cy, bx };
}
const cornerAt = (b: ReturnType<typeof bodiesAt>): number =>
  mix(Math.min(b.hw, b.hh), WIN.r, easeInOut(k01(b.t, 0.3, 0.9)));

type P = [number, number];
/** how far the rounded edge of a box curls away from its flat side at dx from the middle: an
 *  anchor sits on the surface, not in the air beside a round shoulder */
function curl(dx: number, half: number, rc: number): number {
  const out = Math.abs(dx) - (half - rc);
  return out <= 0 ? 0 : rc - Math.sqrt(Math.max(0, rc * rc - out * out));
}
function anchorAt(id: Anchor, b: ReturnType<typeof bodiesAt>): P {
  if (id in ISL) {
    const dx = clamp(ISL[id as keyof typeof ISL] * (b.iw / 340), -b.iw / 2 + 3, b.iw / 2 - 3);
    return [CX + dx, b.ih - 3 - curl(dx, b.iw / 2, I0.r)];
  }
  const rc = cornerAt(b);
  const dx = clamp(BOT[id as keyof typeof BOT] * (b.hw / 360), -b.hw + 3, b.hw - 3);
  return [b.bx + dx, b.cy - b.hh + 3 + curl(dx, b.hw, rc)];
}

/** how hard an edge pulls at t: a pinching thread pulls less, a snapped one not at all */
const pullAt = (e: (typeof EDGES)[number], t: number): number =>
  t >= e.snap ? 0 : e.pull * (1 - 0.6 * k01(t, e.snap - 0.15, e.snap));

/** where the junctions balance: each at the pull-weighted middle of its neighbours */
function balance(t: number, b: ReturnType<typeof bodiesAt>, start: Map<Junction, P>): Map<Junction, P> {
  const pos = new Map<NodeId, P>(start);
  for (const id of [...Object.keys(ISL), ...Object.keys(BOT)] as Anchor[]) pos.set(id, anchorAt(id, b));
  for (let it = 0; it < 30; it++)
    for (const j of JUNCTIONS) {
      let sx = 0,
        sy = 0,
        sw = 0;
      for (const e of EDGES) {
        const other = e.a === j ? e.b : e.b === j ? e.a : null;
        if (!other) continue;
        const w = pullAt(e, t);
        const p = pos.get(other) as P;
        sx += w * p[0];
        sy += w * p[1];
        sw += w;
      }
      if (sw > 1e-6) pos.set(j, [sx / sw, sy / sw]);
    }
  return new Map(JUNCTIONS.map((j) => [j, pos.get(j) as P]));
}

// The junctions and the middles of the threads follow their places on springs, integrated from 0
// in fixed steps - the same t always gives the same frame. Middles are looser: they swing.
const DT = 1 / 480;
const J_SPRING = { w: 2 * Math.PI * 3.6, z: 0.36 },
  M_SPRING = { w: 2 * Math.PI * 4.5, z: 0.32 };
interface WebState {
  t: number;
  jp: Map<Junction, P>;
  jv: Map<Junction, P>;
  mp: P[];
  mv: P[];
}
let cache: WebState | null = null;

function edgeEnds(e: (typeof EDGES)[number], b: ReturnType<typeof bodiesAt>, jp: Map<Junction, P>): [P, P] {
  const at = (id: NodeId): P =>
    JUNCTIONS.includes(id as Junction) ? (jp.get(id as Junction) as P) : anchorAt(id as Anchor, b);
  return [at(e.a), at(e.b)];
}
function midTarget(e: (typeof EDGES)[number], a: P, c: P): P {
  const dx = c[0] - a[0],
    dy = c[1] - a[1];
  return [(a[0] + c[0]) / 2 - dy * e.bow, (a[1] + c[1]) / 2 + dx * e.bow];
}
const springStep = (x: P, v: P, to: P, s: { w: number; z: number }): void => {
  v[0] += (s.w * s.w * (to[0] - x[0]) - 2 * s.z * s.w * v[0]) * DT;
  v[1] += (s.w * s.w * (to[1] - x[1]) - 2 * s.z * s.w * v[1]) * DT;
  x[0] += v[0] * DT;
  x[1] += v[1] * DT;
};

function webAt(t: number): WebState {
  if (!cache || cache.t > t) {
    const b = bodiesAt(0);
    const jp = balance(0, b, new Map(JUNCTIONS.map((j) => [j, [CX, b.ih] as P])));
    const mp = EDGES.map((e) => {
      const [a, c] = edgeEnds(e, b, jp);
      return midTarget(e, a, c);
    });
    cache = { t: 0, jp, jv: new Map(JUNCTIONS.map((j) => [j, [0, 0] as P])), mp, mv: EDGES.map(() => [0, 0] as P) };
  }
  const st = cache;
  while (st.t + DT <= t + 1e-9) {
    st.t += DT;
    const b = bodiesAt(st.t);
    const eq = balance(st.t, b, st.jp);
    for (const j of JUNCTIONS) springStep(st.jp.get(j) as P, st.jv.get(j) as P, eq.get(j) as P, J_SPRING);
    EDGES.forEach((e, i) => {
      const [a, c] = edgeEnds(e, b, st.jp);
      springStep(st.mp[i] as P, st.mv[i] as P, midTarget(e, a, c), M_SPRING);
    });
  }
  return st;
}

/** the timeline, s - the keyframes the strip is judged against */
export function frameAt(t: number): Frame {
  const bd = bodiesAt(t);
  const { iw, ih, hw, hh, cy } = bd;
  const open = easeInOut(k01(t, 0.55, 1.0));
  const corner = cornerAt(bd);

  // 3. the web: a sheet while the gap is short (the threads swollen enough to melt into one film),
  // threads as it stretches; each thread thinner the longer it is (its volume shared out), pinching
  // before it snaps, its halves drawing back into what they hang from
  const gapY = cy - hh - ih;
  // measured against the gap it will reach: from the open island the window is only ~110 px away,
  // and a film that waited for 220 px never became threads
  const G = Math.max(60, WIN.y - I0.h);
  const wk = clamp((gapY - 0.12 * G) / (0.72 * G));
  const web = 1 - wk * wk * (3 - 2 * wk);
  const ws = webAt(t);
  const edges: Edge[] = [];
  const nodeR = new Map<Junction, number>();
  // a knot only where three or more threads still meet: two make a bend, one a stub going home
  const holding = new Map<Junction, number>();
  EDGES.forEach((e, i) => {
    const [a, b] = edgeEnds(e, bd, ws.jp);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const born = clamp((gapY - 2) / 24);
    // short stubs melt into the surface instead of standing on it as bumps
    const fade = easeInOut(clamp((len - 10) / 30));
    // never under 1.1 px: a hairline thinner than a pixel flickers instead of thinning
    const r = (Math.max(1.1, e.r * clamp(Math.sqrt(110 / (len + 1)), 0.5, 1.5)) + web * 22) * born * fade;
    const gaps: [number, number] = [halfGap(e, e.a, t), halfGap(e, e.b, t)];
    const gap = Math.max(...gaps);
    if (Math.min(...gaps) >= 1 || r < 0.3) return;
    const m = ws.mp[i] as P;
    // the curve passes through the lagging middle
    const c: P = [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2];
    edges.push({
      a,
      b,
      c,
      r,
      pinch: e.pinch,
      depth: 0.9 * easeIn(k01(t, e.snap - 0.2, e.snap)),
      gap,
      gaps,
      feet: [footOf(e.a), footOf(e.b)],
      // a symbiote's tendrils are alive: a wave runs along each, more the longer it is stretched,
      // and a snapped one lashes before it is home
      wave: [Math.min(len * 0.045, 9) * (1 - web) * (1 + 1.5 * gap * (1 - gap) * 4), i * 2.1],
    });
    if (t < e.snap)
      for (const id of [e.a, e.b])
        if (JUNCTIONS.includes(id as Junction)) {
          nodeR.set(id as Junction, Math.max(nodeR.get(id as Junction) ?? 0, r));
          holding.set(id as Junction, (holding.get(id as Junction) ?? 0) + 1);
        }
  });
  const nodes: [number, number, number][] = JUNCTIONS.filter((j) => (holding.get(j) ?? 0) >= 3).map((j) => {
    const p = ws.jp.get(j) as P;
    return [p[0], p[1], (nodeR.get(j) as number) * 1.15];
  });

  // 4. the mascot rides the body: it peeks out as the body leaves the island, squints as the first
  // thick thread snaps, and is in its place in the header before the content shows - its eyes never
  // cross the text - then the header's own mascot takes over
  const rr = Math.min(hw, hh);
  const peek = easeOut(k01(t, 0.14, 0.3));
  const go = easeInOut(k01(t, 0.42, 0.68));
  const blink = Math.abs(t - 0.5) < 0.035 ? 0.15 : 1;
  const squint = 1 - 0.55 * Math.exp(-(((t - 0.58) / 0.06) ** 2));
  const ex = mix(bd.bx, EYE_HOME.x, go),
    ey = mix(cy - Math.min(rr, 60) * 0.25, EYE_HOME.y, go);
  const eyeR = Math.min(rr, 46);
  const eyes: Frame['eyes'] = [
    ex,
    ey,
    mix(eyeR * 0.27, EYE_HOME.half, go),
    peek * (1 - easeOut(k01(t, 0.7, 0.84))),
    mix(eyeR * 0.085, EYE_HOME.w, go),
    mix(eyeR * 0.17, EYE_HOME.h, go) * blink * squint,
  ];
  return {
    web,
    island: [iw, ih],
    body: [cy, Math.max(hw, 1), Math.max(hh, 1), corner],
    bx: bd.bx,
    edges,
    nodes,
    eyes,
    open,
    content: easeOut(k01(t, 0.68, 0.94)),
  };
}

const VERT = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec2 uIsland;      // w, h
uniform float uIslandR;    // its lower corners
uniform vec4 uBody;        // cy, half w, half h, corner
uniform vec4 uSA[24];      // edge: one end, the other
uniform vec4 uSB[24];      // edge: radius, pinch, depth, gap
uniform vec2 uSC[24];      // edge: the curve's control point
uniform vec3 uNode[8];     // junctions: x, y, r
uniform vec2 uSG[24];      // edge: how far each half has drawn back
uniform vec2 uSF[24];      // edge: how wide each end flares
uniform vec2 uSW[24];      // edge: the writhe, amplitude and phase
uniform float uT;
uniform float uOpen, uContent, uCX, uBX, uWeb;
uniform float uDpr;
uniform float uWall;       // 1: a wallpaper behind (the design page), 0: transparent (the app)
uniform float uLive;       // the real window is shown: the body is not drawn, the threads are
uniform vec3 uFill;        // the window's own colour, which the body turns into
uniform vec4 uWin;         // x, y, w, h
uniform vec4 uEye;         // x, y, half spacing, alpha
uniform vec2 uEyeSize;     // half w, half h
uniform sampler2D uTex;
out vec4 o;

float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0., 1.); return mix(b, a, h) - k*h*(1.-h); }
float box(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.)) + min(max(q.x,q.y),0.) - r; }

// the thread's radius at h: pinched near its pinch, narrowing to a point at a cut end
float rad(float h, vec4 sb, vec2 ft, float h0, float h1, float cutLo, float cutHi){
  float r = sb.x * (1. - sb.z * exp(-pow((h - sb.y) / .13, 2.)));
  // the feet: a cone where it holds on to a surface, barely any at a knot
  r *= 1. + ft.x * exp(-h / .16) + ft.y * exp(-(1. - h) / .16);
  // a torn tendril ends in a point, not a drop
  if (cutHi > 0.) r *= mix(.06, 1., smoothstep(0., .22, h1 - h));
  if (cutLo > 0.) r *= mix(.06, 1., smoothstep(0., .22, h - h0));
  return r;
}
vec2 bez(vec2 a, vec2 c, vec2 b, float t){ return mix(mix(a, c, t), mix(c, b, t), t); }
// the tendril's spine: the curve, writhing - a wave running from the island down, still at the ends
vec2 spine(vec2 a, vec2 c, vec2 b, float u, vec2 wv){
  vec2 n = normalize(vec2(a.y - b.y, b.x - a.x) + 1e-4);
  return bez(a, c, b, u) + n * wv.x * sin(3.14159 * u) * sin(6.2832 * (1.3 * u - 2.4 * uT) + wv.y);
}

// one part of a curved thread, between h0 and h1: the curve as 8 short capsules
float part(vec2 p, vec2 a, vec2 c, vec2 b, float h0, float h1, vec4 sb, vec2 ft, vec2 wv, float cutLo, float cutHi){
  float d = 1e5;
  for (int j = 0; j < 8; j++) {
    float u0 = mix(h0, h1, float(j) / 8.), u1 = mix(h0, h1, float(j + 1) / 8.);
    vec2 p0 = spine(a, c, b, u0, wv), p1 = spine(a, c, b, u1, wv);
    vec2 pa = p - p0, ba = p1 - p0;
    float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.);
    float u = mix(u0, u1, k);
    d = min(d, length(pa - ba * k) - rad(u, sb, ft, h0, h1, cutLo, cutHi));
  }
  return d;
}

float threads(vec2 p){
  float d = 1e5;
  for (int i = 0; i < 24; i++) {
    vec4 sb = uSB[i];
    if (sb.x < .3) continue;
    vec2 a = uSA[i].xy, b = uSA[i].zw, c = uSC[i];
    // far from this edge's hull: its rough distance is enough
    vec2 lo = min(min(a, b), c) - sb.x * 3. - 60., hi = max(max(a, b), c) + sb.x * 3. + 60.;
    if (any(lessThan(p, lo)) || any(greaterThan(p, hi))) { d = min(d, 40.); continue; }
    // while it is a sheet, neighbouring threads melt into each other
    float kw = 2. + 30. * uWeb;
    if (sb.w <= 0.) d = smin(d, part(p, a, c, b, 0., 1., sb, uSF[i], uSW[i], 0., 0.), kw);
    else {
      // snapped: each half draws back into what it hangs from
      float top = sb.y * (1. - uSG[i].x), bot = sb.y + (1. - sb.y) * uSG[i].y;
      if (top > .01) d = smin(d, part(p, a, c, b, 0., top, sb, uSF[i], uSW[i], 0., 1.), kw);
      if (bot < .99) d = smin(d, part(p, a, c, b, bot, 1., sb, uSF[i], uSW[i], 1., 0.), kw);
    }
  }
  // the junctions: a knot of liquid where threads meet
  for (int i = 0; i < 8; i++) if (uNode[i].z > .3) d = smin(d, length(p - uNode[i].xy) - uNode[i].z, 6.);
  return d;
}

// the island hangs from the top edge; the band above the screen gives it concave shoulders
float islandF(vec2 p){
  float isl = box(p - vec2(uCX, (uIsland.y - 60.) * .5), vec2(uIsland.x * .5, (uIsland.y + 60.) * .5), uIslandR);
  return smin(isl, p.y, 9.);
}
float bodyF(vec2 p){ return box(p - vec2(uBX, uBody.x), uBody.yz, uBody.w); }

float field(vec2 p){
  float d = islandF(p);
  float body = bodyF(p);
  // the joins: thick fillets where threads hold on, like oil, softer once it is a window
  float k = 16. * (1. - uOpen * .7);
  float th = threads(p);
  return min(smin(d, th, k), smin(body, th, k));
}

// the screen behind: a dark wallpaper with a soft violet wave, like the owner's
vec3 wall(vec2 uv){
  vec3 c = mix(vec3(.05,.06,.12), vec3(.11,.09,.22), uv.y);
  float w = sin(uv.x * 3.1 + uv.y * 4.2) * .5 + .5;
  c += vec3(.10,.08,.22) * pow(w, 6.) * .6;
  c *= 1. - .35 * length(uv - .5);
  return c;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 uv = p / (uRes / uDpr);
  float d = field(p);
  // a soft shadow on the screen under it, deeper as it becomes a window; only the island and the
  // window cast it - a thread is too thin to shade a lit desk, and its shadow read as a second,
  // blurred thread beside it. Once the real window is there, its own shadow takes over.
  float dsI = islandF(p - vec2(0., 14.)), dsB = bodyF(p - vec2(0., 14.)) + 1e4 * uLive;
  float sh = .5 * exp(-max(min(dsI, dsB), 0.) / (18. + 30. * uOpen)) * smoothstep(-1., 24., d);
  // the island's own material: matte black with a hairline of light along its edge; the body turns
  // into the window's colour as it becomes one
  float a = smoothstep(.8, -.8, d);
  float inBody = smoothstep(.8, -.8, bodyF(p));
  vec3 body = mix(vec3(0.), uFill, uOpen * inBody) + vec3(1.) * smoothstep(1.4, 0., abs(d + .8)) * .09;
  vec2 wuv = (p - uWin.xy) / uWin.zw;
  if (uContent > 0. && wuv.x > 0. && wuv.x < 1. && wuv.y > 0. && wuv.y < 1.) {
    float inside = smoothstep(.8, -.8, box(p - (uWin.xy + uWin.zw * .5), uWin.zw * .5, uBody.w));
    body = mix(body, texture(uTex, wuv).rgb, uContent * inside);
  }
  a *= 1. - uLive * inBody;
  float e = 0.;
  if (uEye.w > 0.) {
    float r = min(uEyeSize.x, uEyeSize.y);
    float eye = min(box(p - uEye.xy - vec2(uEye.z, 0.), uEyeSize, r), box(p - uEye.xy + vec2(uEye.z, 0.), uEyeSize, r));
    e = smoothstep(.7, -.7, eye) * uEye.w;
  }
  vec3 eyeCol = vec3(.96,.96,.95);
  if (uWall > .5) {
    vec3 col = mix(wall(uv) * (1. - sh), body, a);
    o = vec4(mix(col, eyeCol, e), 1.);
  } else {
    // premultiplied: the body over its shadow, the eyes over both
    float al = a + (1. - a) * sh;
    vec3 rgb = body * a;
    o = vec4(rgb * (1. - e) + eyeCol * e, al * (1. - e) + e);
  }
}`;

/** a WebGL player of the scene on `canvas`; `texture`: a frame of the window, faded in as content
 *  (the design page only - in the app the real window shows its own) */
export function createOpening(
  canvas: HTMLCanvasElement,
  opts: { wall: boolean; texture?: string; fill?: [number, number, number]; onReady?: () => void },
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: true,
    alpha: !opts.wall,
  }) as WebGL2RenderingContext;
  const shader = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type) as WebGLShader;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    return sh;
  };
  const prog = gl.createProgram() as WebGLProgram;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n: string) => gl.getUniformLocation(prog, n);

  let texReady = !opts.texture;
  let cur = 0;
  let live = 0;
  if (opts.texture) {
    const tex = gl.createTexture();
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      texReady = true;
      draw(cur);
      opts.onReady?.();
    };
    img.src = opts.texture;
  }

  function draw(t: number): void {
    cur = t;
    const f = frameAt(t);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U('uRes'), canvas.width, canvas.height);
    gl.uniform1f(U('uDpr'), dpr);
    gl.uniform1f(U('uWall'), opts.wall ? 1 : 0);
    gl.uniform1f(U('uLive'), live);
    gl.uniform3f(U('uFill'), ...(opts.fill ?? [0, 0, 0]));
    gl.uniform1f(U('uCX'), CX);
    gl.uniform1f(U('uBX'), f.bx);
    gl.uniform2f(U('uIsland'), ...f.island);
    gl.uniform1f(U('uIslandR'), I0.r);
    gl.uniform4f(U('uBody'), ...f.body);
    const sa: number[] = [],
      sb: number[] = [];
    for (let i = 0; i < 24; i++) {
      const st = f.edges[i];
      sa.push(...(st ? [...st.a, ...st.b] : [0, 0, 0, 0]));
      sb.push(...(st ? [st.r, st.pinch, st.depth, st.gap] : [0, 0, 0, 0]));
    }
    gl.uniform4fv(U('uSA'), sa);
    gl.uniform2fv(U('uSC'), Array.from({ length: 24 }, (_, i) => f.edges[i]?.c ?? [0, 0]).flat());
    gl.uniform4fv(U('uSB'), sb);
    gl.uniform2fv(U('uSW'), Array.from({ length: 24 }, (_, i) => f.edges[i]?.wave ?? [0, 0]).flat());
    gl.uniform1f(U('uT'), t);
    gl.uniform2fv(U('uSF'), Array.from({ length: 24 }, (_, i) => f.edges[i]?.feet ?? [0, 0]).flat());
    gl.uniform2fv(U('uSG'), Array.from({ length: 24 }, (_, i) => f.edges[i]?.gaps ?? [0, 0]).flat());
    gl.uniform3fv(U('uNode'), Array.from({ length: 8 }, (_, i) => f.nodes[i] ?? [0, 0, 0]).flat());
    gl.uniform1f(U('uOpen'), f.open);
    gl.uniform1f(U('uWeb'), f.web);
    gl.uniform1f(U('uContent'), opts.texture && texReady ? f.content : 0);
    gl.uniform4f(U('uEye'), f.eyes[0], f.eyes[1], f.eyes[2], f.eyes[3]);
    gl.uniform2f(U('uEyeSize'), f.eyes[4], f.eyes[5]);
    gl.uniform4f(U('uWin'), WIN.x, WIN.y, WIN.w, WIN.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  return {
    draw,
    ready: () => texReady,
    /** the real window is up: stop drawing the body, keep the threads */
    setLive(on: boolean) {
      live = on ? 1 : 0;
    },
  };
}
