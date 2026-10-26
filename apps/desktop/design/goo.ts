// The settings window's opening as a sequence (CLAUDE.md rule 3): the scene of src/opening-scene.ts
// over a wallpaper, with a frame of the window as its content, on a MacBook Air 15" screen.
// ?t=0.6 holds one moment; window.__goo.setT(t) drives frames for tools/goo-strip.mjs.
import { configure, createOpening, END } from '../src/opening-scene';

// ?open: asked for from the open island (its settings card), as in the app from the island
if (new URLSearchParams(location.search).has('open'))
  configure({
    w: 1710,
    h: 1107,
    cx: 855,
    island: { w: 600, h: 180, r: 22, open: true },
    win: { x: 495, y: 293.5, w: 720, h: 520, r: 16 },
  });
const canvas = document.getElementById('c') as HTMLCanvasElement;
const player = createOpening(canvas, { wall: true, texture: './goo-window.png' });

function draw(t: number): void {
  player.draw(t);
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
    draw(Math.min(t, END));
    if (t < END) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
});
const q = new URLSearchParams(location.search).get('t');
if (new URLSearchParams(location.search).has('film')) (document.querySelector('.bar') as HTMLElement).hidden = true;
draw(q ? +q : 0);
Object.assign(window, { __goo: { setT: draw, ready: player.ready } });
