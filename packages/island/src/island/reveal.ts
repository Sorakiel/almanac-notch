import { clamp } from '../util/math';
import type { Ctx } from '../util/draw';
import type { IslandState, Tab } from '../sim/state';

// Tab switches and the open island's content move in sequence, not in one frame (docs/CHANGES.md
// 2026-10-19). Order after Grok Bot (Novra, clip 11/10): the old view leaves first, then the new one
// comes in layer by layer, top-left first. coucou cross-fades both views at once, which reads muddier.

/** the old tab fades out in this long: short, so the click feels answered at once */
export const TAB_OUT = 0.1;
/** each layer of the new view comes in over this long */
export const LAYER_IN = 0.24;
/** delay between layers: enough to read as an order, short enough to stay one gesture */
export const LAYER_STEP = 0.04;
/** layers rise this far while they fade in */
export const RISE = 6;

const easeOut = (k: number) => 1 - (1 - k) ** 3;

export function switchTab(s: IslandState, tab: Tab): void {
  if (tab === s.tab) return;
  s.prevTab = s.tab;
  s.tab = tab;
  s.tabStart = s.t;
}

/** 1 → 0 while the old tab leaves; 0 once it is gone (or there was no switch) */
export function tabOutA(s: IslandState): number {
  if (s.prevTab === s.tab) return 0;
  const k = (s.t - s.tabStart) / TAB_OUT;
  return k >= 1 || k < 0 ? 0 : 1 - k;
}

let leaving = false;
/** while the old tab is drawn its layers stay put: only the view coming in is layered */
export function drawLeaving(draw: () => void): void {
  leaving = true;
  try {
    draw();
  } finally {
    leaving = false;
  }
}

/** progress 0 → 1 of layer i of the view being revealed */
export function layerK(s: IslandState, i: number): number {
  if (leaving) return 1;
  // the new view starts while the old one is at ~40 %: with no overlap the frame between reads as a blink
  const t0 = Math.max(s.revealStart, s.tabStart + TAB_OUT * 0.6) + i * LAYER_STEP;
  return easeOut(clamp((s.t - t0) / LAYER_IN, 0, 1));
}

/** the left card both views share is drawn once by drawOpen and morphs; the views skip their own */
export const shared = { card: false };

/** fade and rise layer i; the caller wraps it in save/restore */
export function layer(s: IslandState, c: Ctx, i: number): void {
  const k = layerK(s, i);
  if (k >= 1) return;
  c.globalAlpha *= k;
  // what sits in the shared card does not rise: the card stays, only its content changes
  if (!(shared.card && i === 0)) c.translate(0, (1 - k) * RISE);
}

/** spring step response (ζ < 1), the shape SwiftUI's spring(response, damping) draws */
export function springK(t: number, response: number, damping: number): number {
  if (t <= 0) return 0;
  const w = (2 * Math.PI) / response,
    wd = w * Math.sqrt(1 - damping * damping);
  const v =
    1 -
    Math.exp(-damping * w * t) * (Math.cos(wd * t) + (damping / Math.sqrt(1 - damping * damping)) * Math.sin(wd * t));
  return t > response * 3 ? 1 : v;
}

/** draw one layer of the view being revealed */
export function inLayer(s: IslandState, c: Ctx, i: number, draw: () => void): void {
  c.save();
  layer(s, c, i);
  draw();
  c.restore();
}
