// The settings window comes out of the island and pulls away from it like oil (owner, 2026-10-26):
// the island pushes out a body, the body pulls down to where the window will be, and between them
// threads stretch - thinner as they lengthen, each pinching at its own place until it snaps, the
// halves drawing back into the island and into the window, a bead falling from each snap.
//
// Everything is one signed-distance field: the island (with its concave shoulders at the top
// edge), the body, the threads and the beads are joined with a smooth minimum, so the fillets
// where a thread holds on are the field itself and every edge stays sharp at any size. The
// material is the island's: matte black with a hairline of light - no gloss (owner).
import { springK } from '@almanac-notch/island';

const W = 1710,
  H = 1107;
/** the island at rest: the closed strip under the notch (MacBook Air 15", 185 x 33.5 notch) */
const CX = W / 2,
  I0 = { w: 250, h: 33.5 };
/** the settings window: 720 x 520, centred (src-tauri settings.rs) */
const WIN = { w: 720, h: 520, top: (H - 520) / 2, r: 22 };
const WCY = WIN.top + WIN.h / 2;

const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
const k01 = (t: number, a: number, b: number): number => clamp((t - a) / (b - a));
const easeOut = (k: number): number => 1 - (1 - k) ** 3;
const easeIn = (k: number): number => k * k * k;
const easeInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

interface Strand {
  a: [number, number]; // on the island
  b: [number, number]; // on the window
  c: [number, number]; // the curve's control point: oil sags and sways, it is never a rod
  r: number; // radius at rest
  pinch: number; // where along it the thread pinches, 0..1
  depth: number; // how pinched, 0..1
  gap: number; // after the snap: how far both halves have drawn back, 0..1
}

interface Frame {
  island: [number, number]; // w, h
  body: [number, number, number, number]; // cy, half w, half h, corner
  strands: Strand[];
  beads: [number, number, number][]; // x, y, r
  eyes: [number, number, number, number, number, number]; // x, y, half spacing, alpha, half w, half h
  open: number; // 0 a blob of the island → 1 the window (softens the joins)
  web: number; // how much the threads still melt into one sheet: 1 at first, 0 once stretched
  content: number;
}

/** where the header's mascot of the Island page has its eyes in the window (measured: its 150 x 120
 *  canvas at 518, 44; R = 46 * 0.58; eyes just above the body's middle) */
const EYE_HOME = { x: CX - WIN.w / 2 + 593, y: WIN.top + 104, half: 8, w: 2.6, h: 5.2 };

/** the threads, left to right: where they hold on the island and on the window (fractions of the
 *  half widths), how thick, where they pinch, when they snap - the thick middle one holds longest */
const THREADS = [
  { ia: -0.4, wb: -0.78, r: 5, pinch: 0.62, snap: 0.42, bow: -0.16 },
  { ia: -0.19, wb: -0.36, r: 8, pinch: 0.4, snap: 0.55, bow: -0.08 },
  { ia: 0.02, wb: 0.06, r: 12, pinch: 0.5, snap: 0.7, bow: 0.03 },
  { ia: 0.21, wb: 0.42, r: 7.5, pinch: 0.58, snap: 0.5, bow: 0.1 },
  { ia: 0.38, wb: 0.8, r: 4.5, pinch: 0.36, snap: 0.38, bow: 0.18 },
];

/** the timeline, s - the keyframes the strip is judged against */
export function frameAt(t: number): Frame {
  // 1. the island gathers itself (0 - 0.2) and, once the last thread lets go, settles on a spring
  const swell = easeOut(k01(t, 0, 0.2));
  const settle = springK(Math.max(0, t - 0.7), 0.4, 0.42);
  const gather = Math.max(-0.15, swell * (1 - settle));
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
  const open = easeInOut(k01(t, 0.55, 1.0));
  const corner = mix(Math.min(hw, hh), WIN.r, easeInOut(k01(t, 0.3, 0.9)));

  // 3. the threads: from the island's lower edge to the window's upper edge; the longer they get
  // the thinner, each pinching at its own place until it snaps; then the halves draw back into the
  // island and into the window, and the pinch becomes a bead that falls into the window
  // a sheet first, threads later: the threads start swollen enough to melt into one film, and as
  // it stretches they thin into strands - holes open between them as a real film tears
  const gapY = cy - hh - ih;
  const wk = clamp((gapY - 30) / 190);
  const web = 1 - wk * wk * (3 - 2 * wk);
  const strands: Strand[] = [];
  const beads: [number, number, number][] = [];
  const bodyTop = cy - hh;
  for (const th of THREADS) {
    const a: [number, number] = [CX + th.ia * iw, ih - 3];
    const b: [number, number] = [CX + th.wb * hw, bodyTop + 3];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const born = clamp((len - 4) / 30);
    // thinner as it stretches: the volume is shared out over the length
    const r = (th.r * Math.sqrt(clamp(90 / (len + 1), 0.12, 1)) + web * 30) * born;
    const depth = 0.92 * easeIn(k01(t, th.snap - 0.2, th.snap));
    const gap = easeOut(k01(t, th.snap, th.snap + 0.24));
    // the bow: outward and a little down, swaying slowly as it stretches
    const i = THREADS.indexOf(th);
    const sway = Math.sin(t * 7 + i * 1.7) * 0.05;
    const c: [number, number] = [
      (a[0] + b[0]) / 2 + (th.bow + sway) * len,
      (a[1] + b[1]) / 2 + Math.abs(th.bow) * len * 0.25,
    ];
    if (t < th.snap + 0.24) strands.push({ a, b, c, r, pinch: th.pinch, depth, gap: t < th.snap ? 0 : gap });
    if (t >= th.snap) {
      // the bead the pinch leaves: it falls after the window and melts into it
      const k = easeIn(k01(t, th.snap, th.snap + 0.3));
      const y0 = mix(a[1], b[1], th.pinch);
      const x = mix(mix(a[0], b[0], th.pinch) + th.bow * len * 0.5, b[0], k);
      const y = mix(y0, b[1] + 6, k);
      const br = th.r * 0.7 * (1 - k01(t, th.snap + 0.22, th.snap + 0.32));
      if (br > 0.3) beads.push([x, y, br]);
    }
  }

  // 4. the mascot rides the body: it peeks out as the body leaves the island, looks back up at
  // the threads, squints as the last one snaps, then goes to its place in the header
  const rr = Math.min(hw, hh);
  const peek = easeOut(k01(t, 0.14, 0.3));
  const go = easeInOut(k01(t, 0.72, 1.02));
  const blink = Math.abs(t - 0.5) < 0.035 ? 0.15 : 1;
  const squint = 1 - 0.55 * Math.exp(-(((t - 0.74) / 0.06) ** 2));
  const ex = mix(CX, EYE_HOME.x, go),
    ey = mix(cy - Math.min(rr, 60) * 0.25, EYE_HOME.y, go);
  const eyeR = Math.min(rr, 46);
  const eyes: Frame['eyes'] = [
    ex,
    ey,
    mix(eyeR * 0.27, EYE_HOME.half, go),
    peek * (1 - easeOut(k01(t, 1.04, 1.2))),
    mix(eyeR * 0.085, EYE_HOME.w, go),
    mix(eyeR * 0.17, EYE_HOME.h, go) * blink * squint,
  ];
  return {
    web,
    island: [iw, ih],
    body: [cy, Math.max(hw, 1), Math.max(hh, 1), corner],
    strands,
    beads,
    eyes,
    open,
    content: easeOut(k01(t, 0.95, 1.25)),
  };
}

const VERT = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec2 uIsland;      // w, h
uniform vec4 uBody;        // cy, half w, half h, corner
uniform vec4 uSA[5];       // thread: island end, window end
uniform vec4 uSB[5];       // thread: radius, pinch, depth, gap
uniform vec2 uSC[5];       // thread: the curve's control point
uniform vec3 uBead[5];
uniform float uOpen, uContent, uCX, uWeb;
uniform vec4 uWin;         // x, y, w, h
uniform vec4 uEye;         // x, y, half spacing, alpha
uniform vec2 uEyeSize;     // half w, half h
uniform sampler2D uTex;
out vec4 o;

float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0., 1.); return mix(b, a, h) - k*h*(1.-h); }
float box(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.)) + min(max(q.x,q.y),0.) - r; }

// the thread's radius at h: pinched near its pinch, narrowing to a point at a cut end
float rad(float h, vec4 sb, float h0, float h1, float cutLo, float cutHi){
  float r = sb.x * (1. - sb.z * exp(-pow((h - sb.y) / .13, 2.)));
  if (cutHi > 0.) r *= mix(.3, 1., smoothstep(0., .14, h1 - h));
  if (cutLo > 0.) r *= mix(.3, 1., smoothstep(0., .14, h - h0));
  return r;
}
vec2 bez(vec2 a, vec2 c, vec2 b, float t){ return mix(mix(a, c, t), mix(c, b, t), t); }

// one part of a curved thread, between h0 and h1: the curve as 8 short capsules
float part(vec2 p, vec2 a, vec2 c, vec2 b, float h0, float h1, vec4 sb, float cutLo, float cutHi){
  float d = 1e5;
  for (int j = 0; j < 8; j++) {
    float u0 = mix(h0, h1, float(j) / 8.), u1 = mix(h0, h1, float(j + 1) / 8.);
    vec2 p0 = bez(a, c, b, u0), p1 = bez(a, c, b, u1);
    vec2 pa = p - p0, ba = p1 - p0;
    float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.);
    float u = mix(u0, u1, k);
    d = min(d, length(pa - ba * k) - rad(u, sb, h0, h1, cutLo, cutHi));
  }
  return d;
}

float threads(vec2 p){
  float d = 1e5;
  for (int i = 0; i < 5; i++) {
    vec4 sb = uSB[i];
    if (sb.x < .3) continue;
    vec2 a = uSA[i].xy, b = uSA[i].zw, c = uSC[i];
    // while it is a sheet, neighbouring threads melt into each other
    float kw = 2. + 30. * uWeb;
    if (sb.w <= 0.) d = smin(d, part(p, a, c, b, 0., 1., sb, 0., 0.), kw);
    else {
      // snapped: the upper half draws back into the island, the lower one into the window
      float top = sb.y * (1. - sb.w), bot = sb.y + (1. - sb.y) * sb.w;
      if (top > .01) d = smin(d, part(p, a, c, b, 0., top, sb, 0., 1.), kw);
      if (bot < .99) d = smin(d, part(p, a, c, b, bot, 1., sb, 1., 0.), kw);
    }
  }
  return d;
}

float field(vec2 p){
  // the island hangs from the top edge; the band above the screen gives it concave shoulders
  float isl = box(p - vec2(uCX, (uIsland.y - 60.) * .5), vec2(uIsland.x * .5, (uIsland.y + 60.) * .5), 13.);
  float d = smin(isl, p.y, 9.);
  float body = box(p - vec2(uCX, uBody.x), uBody.yz, uBody.w);
  float beads = 1e5;
  for (int i = 0; i < 5; i++) if (uBead[i].z > .3) beads = min(beads, length(p - uBead[i].xy) - uBead[i].z);
  // the joins: thick fillets where threads hold on, like oil, softer once it is a window
  float k = 16. * (1. - uOpen * .7);
  float th = threads(p);
  return min(smin(smin(d, th, k), smin(body, beads, 10.), k), smin(body, th, k));
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
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = p / uRes;
  vec3 col = wall(uv);
  float d = field(p);
  // a soft shadow on the screen under it, deeper as it becomes a window
  float ds = field(p - vec2(0., 14.));
  col *= 1. - .5 * exp(-max(ds, 0.) / (18. + 30. * uOpen)) * smoothstep(-1., 24., d);
  // the island's own material: matte black with a hairline of light along its edge
  float a = smoothstep(.8, -.8, d);
  vec3 body = vec3(0.) + vec3(1.) * smoothstep(1.4, 0., abs(d + .8)) * .09;
  vec2 wuv = (p - uWin.xy) / uWin.zw;
  if (uContent > 0. && wuv.x > 0. && wuv.x < 1. && wuv.y > 0. && wuv.y < 1.) {
    float inside = smoothstep(.8, -.8, box(p - (uWin.xy + uWin.zw * .5), uWin.zw * .5, 22.));
    body = mix(body, texture(uTex, wuv).rgb, uContent * inside);
  }
  col = mix(col, body, a);
  if (uEye.w > 0.) {
    float r = min(uEyeSize.x, uEyeSize.y);
    float eye = min(box(p - uEye.xy - vec2(uEye.z, 0.), uEyeSize, r), box(p - uEye.xy + vec2(uEye.z, 0.), uEyeSize, r));
    col = mix(col, vec3(.96,.96,.95), smoothstep(.7, -.7, eye) * uEye.w);
  }
  o = vec4(col, 1.);
}`;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext;
function shader(type: number, src: string): WebGLShader {
  const s = gl.createShader(type) as WebGLShader;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}
const prog = gl.createProgram() as WebGLProgram;
gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
gl.useProgram(prog);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'a');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const U = (n: string) => gl.getUniformLocation(prog, n);

// the window's content: a frame of the real settings window
const tex = gl.createTexture();
let texReady = false;
const img = new Image();
img.onload = () => {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  texReady = true;
  draw(cur);
};
img.src = './goo-window.png';

let cur = 0;
function draw(t: number): void {
  cur = t;
  const f = frameAt(t);
  gl.viewport(0, 0, W, H);
  gl.uniform2f(U('uRes'), W, H);
  gl.uniform1f(U('uCX'), CX);
  gl.uniform2f(U('uIsland'), ...f.island);
  gl.uniform4f(U('uBody'), ...f.body);
  const sa: number[] = [],
    sb: number[] = [];
  for (let i = 0; i < 5; i++) {
    const st = f.strands[i];
    sa.push(...(st ? [...st.a, ...st.b] : [0, 0, 0, 0]));
    sb.push(...(st ? [st.r, st.pinch, st.depth, st.gap] : [0, 0, 0, 0]));
  }
  gl.uniform4fv(U('uSA'), sa);
  gl.uniform2fv(U('uSC'), Array.from({ length: 5 }, (_, i) => f.strands[i]?.c ?? [0, 0]).flat());
  gl.uniform4fv(U('uSB'), sb);
  gl.uniform3fv(U('uBead'), [...f.beads, [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]].slice(0, 5).flat());
  gl.uniform1f(U('uOpen'), f.open);
  gl.uniform1f(U('uWeb'), f.web);
  gl.uniform1f(U('uContent'), texReady ? f.content : 0);
  gl.uniform4f(U('uEye'), f.eyes[0], f.eyes[1], f.eyes[2], f.eyes[3]);
  gl.uniform2f(U('uEyeSize'), f.eyes[4], f.eyes[5]);
  gl.uniform4f(U('uWin'), CX - WIN.w / 2, WIN.top, WIN.w, WIN.h);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  (document.getElementById('tv') as HTMLElement).textContent = t.toFixed(3) + ' с';
  (document.getElementById('t') as HTMLInputElement).value = String(t);
}

// controls: the slider holds one moment, ▶ plays in real time (or 4x slower)
const slider = document.getElementById('t') as HTMLInputElement;
slider.addEventListener('input', () => draw(+slider.value));
let raf = 0;
(document.getElementById('play') as HTMLButtonElement).addEventListener('click', () => {
  cancelAnimationFrame(raf);
  const t0 = performance.now(),
    slow = (document.getElementById('slow') as HTMLInputElement).checked ? 4 : 1;
  const step = (now: number) => {
    const t = (now - t0) / 1000 / slow;
    draw(Math.min(t, 1.6));
    if (t < 1.6) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
});
const q = new URLSearchParams(location.search).get('t');
if (new URLSearchParams(location.search).has('film')) (document.querySelector('.bar') as HTMLElement).hidden = true;
draw(q ? +q : 0);
Object.assign(window, { __goo: { setT: draw, ready: () => texReady } });
