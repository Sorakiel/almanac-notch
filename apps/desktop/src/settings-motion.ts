// How the settings window moves (stage 9f): the island's own language, so a person who has seen
// one recognises the other. A page change is the island's tab change (island/reveal.ts): the old
// page fades out quickly, the new one comes in layer by layer, rising a little; the selection in
// the sidebar travels on the spring of the island's tab capsule instead of blinking from row to row.
import { LAYER_IN, LAYER_STEP, RISE, TAB_OUT, springK } from '@almanac-notch/island';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** cubic ease-out, the island's layers' curve (reveal.ts easeOut) */
const EASE_OUT = 'cubic-bezier(0.33, 1, 0.68, 1)';
/** past this many layers the rest come in together: a settings page is visited often, the whole
 *  change stays under half a second */
const MAX_LAYERS = 4;

/** the new page's layers: the header, then each block in reading order */
export function revealPage(page: HTMLElement, afterOut = true): void {
  if (reduced) return;
  const start = afterOut ? TAB_OUT * 0.6 : 0;
  [...page.children].forEach((el, i) => {
    if (!(el instanceof HTMLElement) || el.hidden) return;
    el.animate(
      [
        { opacity: 0, transform: `translateY(${RISE}px)` },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: LAYER_IN * 1000,
        delay: (start + Math.min(i, MAX_LAYERS) * LAYER_STEP) * 1000,
        easing: EASE_OUT,
        fill: 'backwards',
      },
    );
  });
}

/** the old page leaves over TAB_OUT, laid over the new one so the layout does not jump */
export function leavePage(page: HTMLElement, done: () => void): void {
  if (reduced) return done();
  const box = page.parentElement;
  if (!box) return done();
  const top = page.scrollTop;
  page.classList.add('leaving');
  page.scrollTop = top;
  const a = page.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TAB_OUT * 1000, easing: 'linear' });
  const end = (): void => {
    page.classList.remove('leaving');
    done();
  };
  // the promise, not onfinish: it also settles when the animation is finished or cancelled by hand
  a.finished.then(end, end);
}

// ---------- the sidebar's selection ----------
/** the island's tab capsule spring (open.ts: springK(dt, 0.3, 0.78)) */
const RESPONSE = 0.3,
  DAMPING = 0.78;
let sel: HTMLElement | null = null;
let from = { y: 0, h: 0 },
  to = { y: 0, h: 0 },
  t0 = 0,
  raf = 0;

function place(y: number, h: number): void {
  if (!sel) return;
  sel.style.transform = `translateY(${y}px)`;
  sel.style.height = `${h}px`;
}

function step(now: number): void {
  const k = springK((now - t0) / 1000, RESPONSE, DAMPING);
  place(from.y + (to.y - from.y) * k, from.h + (to.h - from.h) * k);
  raf = (now - t0) / 1000 < RESPONSE * 3 ? requestAnimationFrame(step) : 0;
}

/** move the selection to the row; the first time (or with reduced motion) it simply appears there */
export function selectRow(row: HTMLElement, animate = true): void {
  sel ??= row.parentElement?.querySelector<HTMLElement>('.side-sel') ?? null;
  if (!sel) return;
  const next = { y: row.offsetTop, h: row.offsetHeight };
  // hidden behind the first-run guide it has no size yet: the next call places it
  const shown = sel.classList.contains('on') && sel.offsetHeight > 0;
  if (!animate || reduced || !shown) {
    cancelAnimationFrame(raf);
    raf = 0;
    from = to = next;
    place(next.y, next.h);
    sel.classList.add('on');
    return;
  }
  // from where it is now, even mid-flight: a quick second click must not jump
  const m = /translateY\(([-\d.]+)px\)/.exec(sel.style.transform);
  from = { y: m?.[1] ? +m[1] : to.y, h: sel.offsetHeight || to.h };
  to = next;
  t0 = performance.now();
  if (!raf) raf = requestAnimationFrame(step);
}
