// The settings window's opening in the app (src-tauri opening.rs): the scene of opening-scene.ts
// on a transparent overlay of the island's screen. At SHOW_AT the real window takes the body's
// place; the overlay keeps drawing the threads over it until the last one has let go.
import { invoke } from '@tauri-apps/api/core';
import { configure, createOpening, END, SHOW_AT, type OpeningGeo } from './opening-scene';

/** the settings window's own colour (settings.css --bg), which the body turns into */
const FILL: [number, number, number] = [17 / 255, 17 / 255, 19 / 255];

function run(): void {
  const geo = JSON.parse(decodeURIComponent(location.hash.slice(1))) as OpeningGeo & { slow?: number };
  const slow = Math.max(1, geo.slow ?? 1);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    void invoke('opening_done');
    return;
  }
  configure(geo);
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.style.width = `${geo.w}px`;
  canvas.style.height = `${geo.h}px`;
  const player = createOpening(canvas, { wall: false, fill: FILL });
  player.draw(0);
  let shown = false;
  let t0 = 0;
  const step = (now: number): void => {
    t0 ||= now;
    const t = (now - t0) / 1000 / slow;
    if (!shown && t >= SHOW_AT) {
      shown = true;
      // the body stops being drawn only once the window is surely on screen, a frame later
      void invoke('opening_show').then(() => setTimeout(() => player.setLive(true), 34));
    }
    player.draw(Math.min(t, END));
    if (t < END) requestAnimationFrame(step);
    else void invoke('opening_done');
  };
  requestAnimationFrame(step);
}

try {
  run();
} catch (e) {
  // no WebGL or a bad geometry: never keep the window from the user
  console.error(e);
  void invoke('opening_done');
}
