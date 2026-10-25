// The live mascot of the first-run guide (stage 8f): the island package's stage renderer on a
// transparent background, so it tracks the cursor, can be poked and reacts to the guide's steps.
import {
  createMascot,
  defaultSettings,
  stageDoubleClick,
  stagePointerDown,
  stagePointerMove,
  stageRelease,
  type EventType,
} from '@almanac-notch/island';

export interface WelcomeMascot {
  /** play an event: greeting, success, dance... */
  react: (type: EventType | 'sleep') => void;
  poke: () => void;
  /** run or pause the frame loop (the guide is hidden behind settings) */
  setRunning: (on: boolean) => void;
}

/** `k` < 1: a small canvas (stage 9f) - the stage is drawn at 1/k of the canvas and scaled down */
export function welcomeMascot(canvas: HTMLCanvasElement, k = 1): WelcomeMascot {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const m = createMascot({ settings: defaultSettings(reduced), now: performance.now(), greetAfter: null });
  const s = m.state;
  // dark window: no backdrop or ground line, a stronger contact shadow
  s.theme = {
    top: 'rgba(0,0,0,0)',
    bot: 'rgba(0,0,0,0)',
    ground: 'rgba(0,0,0,0)',
    muted: 'rgba(255,255,255,0.5)',
    unlit: 'rgba(255,255,255,0.08)',
    shadowA: 0.5,
  };
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let dpr = 1;
  // the stage's mascot is never smaller than the prototype's R = 46 (pose.ts geo): a small corner
  // draws the stage at 1/K of the size and scales it down
  const K = k;
  const small = k < 1;
  function resize(): void {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    s.W = small ? Math.max(1, r.width) / K : Math.max(200, r.width);
    s.H = small ? Math.max(1, r.height) / K : Math.max(120, r.height);
    canvas.width = Math.round(s.W * K * dpr);
    canvas.height = Math.round(s.H * K * dpr);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const point = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / K, y: (e.clientY - r.top) / K };
  };
  window.addEventListener('pointermove', (e) => stagePointerMove(s, point(e), performance.now()), { passive: true });
  canvas.addEventListener('pointerdown', (e) => {
    if (stagePointerDown(s, point(e), performance.now())) canvas.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointerup', () => stageRelease(s));
  canvas.addEventListener('dblclick', (e) => stageDoubleClick(s, point(e)));

  let running = false,
    last = performance.now(),
    raf = 0;
  function frame(now: number): void {
    m.update(Math.min(0.05, (now - last) / 1000), now);
    last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    m.renderStage(ctx, dpr * K);
    canvas.style.cursor = m.stageCursor();
    if (running) raf = requestAnimationFrame(frame);
  }
  return {
    react: (type) => m.trigger(type),
    poke: () => m.poke(1, (Math.random() - 0.5) * 0.6, -0.3),
    setRunning: (on) => {
      if (on === running) return;
      running = on;
      cancelAnimationFrame(raf);
      if (on) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
  };
}
