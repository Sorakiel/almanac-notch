// The page headers of the settings window (stage 9f, docs/polish-refs/README.md, "Этап 9f").
// Each page opens like the island greets: the prototype's stars (island/cards.ts STARS) fly out
// of the top edge where the notch would be, then drift and twinkle; the edge glows in the page's
// colour with the island card's own light (cardTint); and the page's module mascot stands on the
// right with its prop, in a mood that says how the module is doing.
import { STARS, type StageLook } from '@almanac-notch/island';
import { welcomeMascot, type WelcomeMascot } from './welcome-mascot';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** a #rrggbb colour at an alpha */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export interface Hero {
  mascot: WelcomeMascot;
  /** the page came on screen: the stars fly out again */
  shown: () => void;
  /** off screen: no frames drawn */
  setRunning: (on: boolean) => void;
}

/** the header's mascot is drawn at 1/K of its canvas (the stage's R never goes under 46) */
const K = 0.58;
/** the greeting's flight, s */
const WARP = 0.6;
/** the window's first page greets with the warp; later pages only fade their sky in */
let greeted = false;

export function makeHero(head: HTMLElement, color: string, look: StageLook | null): Hero {
  head.classList.add('hero');
  const sky = document.createElement('canvas');
  sky.className = 'hero-sky';
  const stage = document.createElement('canvas');
  stage.className = 'hero-mascot';
  head.prepend(sky);
  head.append(stage);
  const mascot = welcomeMascot(stage, K);

  // ---------- a stroll along the header's floor: the mascot has room here, so it uses it ----------
  // It walks a little, stops, looks about, sometimes hops for joy - but only when it is calm and
  // awake: asleep means "not connected", a frown means "needs you", and those must read still.
  let base: StageLook | null = look;
  const rawDress = mascot.dress;
  let x = 0,
    target = 0,
    walking = false,
    dir = -1,
    nextWalk = performance.now() + 1500 + Math.random() * 2500,
    nextStep = 0,
    lastT = performance.now();
  function apply(): void {
    rawDress(
      walking && base?.mood === 'calm'
        ? { ...base, mood: 'watch', at: { x: dir * 0.85, y: 0.05 }, lean: dir * 0.09 }
        : base,
    );
  }
  mascot.dress = (l) => {
    base = l;
    apply();
  };
  apply();
  /** how far left it may go: never under the title */
  function room(): number {
    const text = head.querySelector<HTMLElement>('.head-text');
    if (!text) return 0;
    let right = 0;
    for (const el of text.children) right = Math.max(right, (el as HTMLElement).getBoundingClientRect().right);
    const hr = head.getBoundingClientRect();
    // the body is ~50 px wide in the middle of its 150 px canvas, 18 px from the header's right
    const bodyLeftAtRest = hr.right - 18 - 75 - 25;
    return Math.max(0, bodyLeftAtRest - (right + 16));
  }
  function stroll(now: number): void {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const calm = base?.mood === 'calm' && !mascot.asleep();
    if (!calm || reduced) {
      if (walking) {
        walking = false;
        apply();
      }
      return;
    }
    if (!walking && now > nextWalk) {
      const r = room();
      if (r < 30) {
        // no room to walk: a small hop where it stands, now and then
        mascot.hop(1.4);
        nextWalk = now + 4000 + Math.random() * 4000;
      } else {
        let to = -Math.random() * r;
        if (Math.abs(to - x) < 30) to = x > -r / 2 ? -r : 0;
        target = to;
        dir = target < x ? -1 : 1;
        walking = true;
        nextStep = now;
        apply();
      }
    }
    if (walking) {
      // 38 px/s, a little hop every 0.42 s: steps, not a glide
      const step = 38 * dt * dir;
      if (Math.abs(target - x) <= Math.abs(step)) {
        x = target;
        walking = false;
        apply();
        // arrived: sometimes a hop of joy, then a pause to look about
        if (Math.random() < 0.3) mascot.hop(2.6);
        nextWalk = now + 2500 + Math.random() * 4500;
      } else {
        x += step;
        if (now >= nextStep) {
          mascot.hop(0.9);
          nextStep = now + 420;
        }
      }
      stage.style.transform = `translateX(${x.toFixed(1)}px)`;
    }
  }

  let born = performance.now(),
    raf = 0,
    running = false,
    pointer: { x: number; y: number } | null = null,
    greet = false;
  head.addEventListener('pointermove', (e) => {
    const r = sky.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  head.addEventListener('pointerleave', () => (pointer = null));

  function draw(now: number): void {
    const dpr = window.devicePixelRatio || 1,
      w = sky.clientWidth,
      h = sky.clientHeight;
    if (sky.width !== Math.round(w * dpr) || sky.height !== Math.round(h * dpr)) {
      sky.width = Math.round(w * dpr);
      sky.height = Math.round(h * dpr);
    }
    const c = sky.getContext('2d');
    if (!c || w === 0) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    // the light comes from where the stars do - the notch above - in the page's colour, and it
    // breathes with the mascot: one living thing, not two clocks
    const br = 0.88 + 0.12 * mascot.breath(),
      lx = w * 0.62,
      lr = Math.max(w, h) * 0.75 * br;
    const g = c.createRadialGradient(lx, -h * 0.25, 0, lx, -h * 0.25, lr);
    g.addColorStop(0, rgba(color, 0.42 * br));
    g.addColorStop(0.45, rgba(color, 0.13));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    const el = reduced ? 9 : (now - born) / 1000,
      t = now / 1000;
    // from where the notch would be: the top edge, right of the title
    const cx = w * 0.62,
      cy = -6;
    // the warp only greets the window's first page (as the island greets once); a page change
    // just brings the sky in: a calm window does not fly at the person on every click
    const warp = greet ? Math.min(1, el / WARP) : 1,
      fadeIn = greet ? 1 : Math.min(1, el / 0.3);
    for (const st of STARS) {
      // drawLaunch's flight, then a slow drift outward and a twinkle
      const r = (Math.pow(warp, 1.8) * 0.9 + el * 0.004 + st.d * 0.25) * w * 0.62 * st.s;
      const x = cx + Math.cos(st.a) * r,
        y = cy + Math.abs(Math.sin(st.a)) * r * 0.55;
      if (y > h + 2 || x < -2 || x > w + 2) continue;
      let a = (warp < 1 ? 0.4 + 0.6 * warp : 0.6 + 0.4 * Math.sin(t * 2.2 + st.d * 20)) * 0.85 * fadeIn;
      let size = 1.5 * st.s + 0.3;
      // a third of the sky takes the page's colour: the light tints what it touches
      const tinted = st.d > 0.66;
      // the pointer warms the stars near it - they notice, as the mascot's eyes do
      if (pointer) {
        const d = Math.hypot(x - pointer.x, y - pointer.y);
        if (d < 120) {
          a += (1 - d / 120) * 0.5;
          size *= 1 + (1 - d / 120) * 0.7;
        }
      }
      c.fillStyle = tinted ? rgba(color, Math.min(1, a)) : `rgba(255,255,255,${Math.min(1, a).toFixed(3)})`;
      if (warp < 1) {
        // a short streak behind each star, as in the island's greeting
        const len = 10 * (1 - warp) + 2,
          ux = Math.cos(st.a),
          uy = Math.abs(Math.sin(st.a)) * 0.55,
          n = Math.hypot(ux, uy) || 1;
        c.strokeStyle = c.fillStyle;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x - (ux / n) * len, y - (uy / n) * len);
        c.lineTo(x, y);
        c.stroke();
      } else c.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
  function frame(now: number): void {
    draw(now);
    stroll(now);
    raf = running ? requestAnimationFrame(frame) : 0;
  }
  return {
    mascot,
    shown: () => {
      born = performance.now();
      greet = !greeted;
      greeted = true;
    },
    setRunning: (on) => {
      if (on === running) return;
      running = on;
      mascot.setRunning(on);
      cancelAnimationFrame(raf);
      if (on) raf = requestAnimationFrame(frame);
    },
  };
}
