// The settings window comes out of the island like a drop out of a lava lamp (owner, 2026-10-26):
// the island swells, a bulge is squeezed out of it, the drop falls to where the window will be,
// the neck stretches, thins and breaks into beads - the top one is drawn back into the island,
// the rest fall and merge into the drop - and the drop opens into the window.
//
// Everything is one signed-distance field: the island (with its concave shoulders at the top
// edge), the drop, the beads and the window are joined with a smooth minimum, so the neck is the
// field itself, not a drawn shape, and every edge stays sharp at any size. The black is glossy
// (a height field from the distance, one light from above): liquid, not a flat fill.
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

interface Frame {
  island: [number, number, number]; // w, h, corner
  drop: [number, number, number, number, number]; // cy, half w, half h, corner, m (0 drop → 1 window)
  neck: [number, number, number]; // y top, y bottom, radius (0 = broken)
  beads: [number, number, number][]; // x, y, r
  /** the mascot's eyes riding the drop: centre x, y, half spacing, alpha, eye half w, half h */
  eyes: [number, number, number, number, number, number];
  k: number;
  content: number;
  gloss: number;
}

/** where the header's mascot of the Island page has its eyes in the window (measured: its 150 x 120
 *  canvas at 518, 44; R = 46 * 0.58; eyes just above the body's middle) */
const EYE_HOME = { x: CX - WIN.w / 2 + 593, y: WIN.top + 104, half: 8, w: 2.6, h: 5.2 };

/** the timeline, s - the keyframes the strip is judged against */
export function frameAt(t: number): Frame {
  // 1. the island swells as it gathers the drop (0 - 0.26), then settles on a wobbly spring
  const swell = easeOut(k01(t, 0, 0.26));
  const release = springK(Math.max(0, t - 0.52), 0.4, 0.4);
  // the wobble may dip a little under rest, never collapse the island into a thread
  const gather = Math.max(-0.18, swell * (1 - release));
  const iw = mix(I0.w, I0.w + 80, gather),
    ih = mix(I0.h, I0.h + 24, gather);

  // 2. the bulge is squeezed out (0.04 - 0.3) and falls (0.28 - 0.62): it gathers speed and
  // stretches like a falling drop, then lands with a squash on the window's centre
  const grow = easeOut(k01(t, 0.04, 0.3));
  const fall = k01(t, 0.26, 0.62);
  // gravity: the drop gathers speed (quadratic), the last stretch eased into the landing
  const fallY = fall * fall * 0.8 + easeInOut(fall) * 0.2;
  const r = mix(0, 46, grow) + mix(0, 30, easeOut(fall));
  const speed = fall > 0 && fall < 1 ? Math.sin(fall * Math.PI) : 0;
  const landT = Math.max(0, t - 0.62);
  // the landing: a squash that springs back (wide and low, then round)
  const squash = t > 0.62 ? (1 - springK(landT, 0.3, 0.42)) * 0.32 : 0;
  const cy0 = ih + r * 0.9;
  const cy = mix(cy0, WCY, fall >= 1 ? 1 : fallY) + squash * r * 0.5;
  let hw = r * (1 - speed * 0.12 + squash),
    hh = r * (1 + speed * 0.3 - squash);

  // 3. the neck: one stretched thread that thins as the drop falls and snaps at 0.5
  // it holds until the drop is ~190 pt away, then snaps
  const snap = 0.47;
  const neckR = t < snap ? mix(34, 11, clamp((cy - cy0) / 200)) * clamp(grow * 1.6) : 0;
  const beads: [number, number, number][] = [];
  if (t >= snap) {
    // where it snapped, the thread pulls into beads: the top one goes back to the island, the
    // others fall after the drop, swaying like wax in a lava lamp, and merge into it
    const yTop = ih + 4;
    const fs = k01(snap, 0.26, 0.62),
      ySnap = mix(cy0, WCY, fs * fs * 0.8 + easeInOut(fs) * 0.2);
    const back = easeOut(k01(t, snap, snap + 0.22));
    beads.push([CX, mix(mix(yTop, ySnap, 0.22), yTop - 6, back), 17 * (1 - back)]);
    for (let i = 1; i < 4; i++) {
      const f = 0.3 + i * 0.18;
      // they catch the drop as it lands: the merge is the landing's ripple
      const k = easeIn(k01(t, snap + i * 0.02, 0.64 + i * 0.035));
      const y = mix(mix(yTop, ySnap, f), cy - hh * 0.5, k);
      const x = CX + Math.sin(t * 8 + i * 1.9) * 7 * (1 - k);
      beads.push([x, y, (19 - i * 3) * (1 - k01(t, 0.6 + i * 0.035, 0.72 + i * 0.035))]);
    }
  }

  // 4. the drop opens into the window: the same rounded box grows on the island's spring, its
  // corners going from fully round to the window's 22
  const open = k01(t, 0.7, 1.08);
  const m = easeInOut(open);
  const sz = springK(Math.max(0, t - 0.7), 0.46, 0.6);
  hw = mix(hw, WIN.w / 2, sz);
  hh = mix(hh, WIN.h / 2, sz);
  const corner = mix(Math.min(hw, hh), WIN.r, m);
  // 5. the mascot rides the drop down: it peeks out of the bulge, watches the fall, squints on
  // the landing, then goes to its place in the window's header and hands over to the one there
  const rr = Math.min(hw, hh);
  const peek = easeOut(k01(t, 0.16, 0.3));
  const look = fall > 0 && fall < 1 ? 0.28 : 0;
  const blink = Math.abs(t - 0.4) < 0.035 ? 0.15 : 1;
  const happy = t > 0.62 ? 1 - 0.6 * (1 - springK(landT, 0.3, 0.5)) : 1;
  const go = easeInOut(k01(t, 0.74, 1.04));
  const ex = mix(CX, EYE_HOME.x, go),
    ey = mix(cy - rr * 0.08 + look * rr, EYE_HOME.y, go);
  const eyes: Frame['eyes'] = [
    ex,
    ey,
    mix(Math.max(rr, 1) * 0.27, EYE_HOME.half, go),
    peek * (1 - easeOut(k01(t, 1.06, 1.22))),
    mix(rr * 0.085, EYE_HOME.w, go),
    mix(rr * 0.17, EYE_HOME.h, go) * blink * happy,
  ];
  return {
    eyes,
    island: [iw, ih, 13],
    drop: [cy, Math.max(hw, 1), Math.max(hh, 1), corner, m],
    neck: [ih - 4, cy - hh * 0.4, neckR],
    beads,
    k: 26,
    // 5. the window's own content comes in once the shape has settled
    content: easeOut(k01(t, 0.98, 1.3)),
    gloss: 1 - easeInOut(k01(t, 0.86, 1.25)) * 0.9,
  };
}

const VERT = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uIsland;      // w, h, corner
uniform vec4 uDrop;        // cy, half w, half h, corner
uniform float uM;          // 0 drop -> 1 window
uniform vec3 uNeck;        // y top, y bottom, radius
uniform vec3 uBeads[4];
uniform float uK, uContent, uGloss, uCX;
uniform vec4 uWin;         // x, y, w, h
uniform vec4 uEye;         // x, y, half spacing, alpha
uniform vec2 uEyeSize;     // half w, half h
uniform sampler2D uTex;
out vec4 o;

float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0., 1.); return mix(b, a, h) - k*h*(1.-h); }
float box(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.)) + min(max(q.x,q.y),0.) - r; }

float field(vec2 p){
  // the island hangs from the top edge; the band above the screen gives it concave shoulders
  float top = 60.;
  float isl = box(p - vec2(uCX, (uIsland.y - top) * .5), vec2(uIsland.x * .5, (uIsland.y + top) * .5), uIsland.z);
  float d = smin(isl, p.y, 9.);
  vec2 c = vec2(uCX, uDrop.x);
  float drop = box(p - c, uDrop.yz, uDrop.w);
  // the thread: a capsule from the island to the drop, thinning as it stretches
  float neck = 1e5;
  if (uNeck.z > .3) {
    vec2 a = vec2(uCX, uNeck.x), bb = vec2(uCX, uNeck.y);
    vec2 pa = p - a, ba = bb - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
    // thinner in the middle, as a stretched thread pinches before it snaps
    float rr = uNeck.z * (1. - .55 * sin(h * 3.14159));
    neck = length(pa - ba * h) - rr;
  }
  float b = 1e5;
  for (int i = 0; i < 4; i++) if (uBeads[i].z > .3) b = smin(b, length(p - uBeads[i].xy) - uBeads[i].z, 14.);
  // the island, the thread, the beads and the drop melt into each other
  float k = uK * (1. - uM * .9);
  return smin(smin(smin(d, neck, k), b, k), drop, k);
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
  // a soft shadow under the liquid, deeper as it becomes a window
  float ds = field(p - vec2(0., 16.));
  col *= 1. - .55 * exp(-max(ds, 0.) / (24. + 30. * uM)) * smoothstep(-1., 30., d);

  float a = smoothstep(.8, -.8, d);
  // glossy black: a dome that rises from the edge, lit from the upper left. The normal is taken
  // over 5 px so the field's ridges (the middle of the thread, of a bead) stay smooth, not lines
  // the island itself stays the real island's black: the hand-over to it must not show
  float body = smoothstep(uIsland.y + 4., uIsland.y + 50., p.y);
  float e = 5.;
  float W = 22.;
  float hc = 1. - exp(min(d, 0.) / W);
  float hx = (1. - exp(min(field(p + vec2(e,0.)), 0.) / W)) - (1. - exp(min(field(p - vec2(e,0.)), 0.) / W));
  float hy = (1. - exp(min(field(p + vec2(0.,e)), 0.) / W)) - (1. - exp(min(field(p - vec2(0.,e)), 0.) / W));
  vec3 n = normalize(vec3(-hx * 4., hy * 4., 1.));
  vec3 L = normalize(vec3(-.55, .7, .45));
  vec3 Hh = normalize(L + vec3(0.,0.,1.));
  float spec = pow(max(dot(n, Hh), 0.), 36.) * .55 * smoothstep(.0, .25, 1. - n.z) * body;
  float fres = pow(1. - n.z, 2.5) * .45 * body;
  // a little of the wallpaper's violet in the body, deeper where it is thick: wax, not a hole
  vec3 liquid = vec3(.012) * body + vec3(.05,.045,.09) * hc * uGloss * body + vec3(1.) * spec * uGloss + vec3(.42,.46,.78) * fres * uGloss;
  // the island's rim: a hairline of light along the edge
  liquid += vec3(1.) * smoothstep(1.6, 0., abs(d + .9)) * (.07 + .08 * uGloss);

  // the window's own content, inside its box
  vec2 wuv = (p - uWin.xy) / uWin.zw;
  if (uContent > 0. && wuv.x > 0. && wuv.x < 1. && wuv.y > 0. && wuv.y < 1.) {
    vec4 tex = texture(uTex, wuv);
    float inside = smoothstep(.8, -.8, box(p - (uWin.xy + uWin.zw * .5), uWin.zw * .5, 22.));
    liquid = mix(liquid, tex.rgb, uContent * inside);
  }
  col = mix(col, liquid, a);
  // the mascot's eyes, the island's chalk white
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
  gl.uniform3f(U('uIsland'), ...f.island);
  gl.uniform4f(U('uDrop'), f.drop[0], f.drop[1], f.drop[2], f.drop[3]);
  gl.uniform1f(U('uM'), f.drop[4]);
  gl.uniform3f(U('uNeck'), ...f.neck);
  const beads = [...f.beads, [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]].slice(0, 4);
  gl.uniform3fv(U('uBeads'), beads.flat());
  gl.uniform1f(U('uK'), f.k);
  gl.uniform1f(U('uContent'), texReady ? f.content : 0);
  gl.uniform1f(U('uGloss'), f.gloss);
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
