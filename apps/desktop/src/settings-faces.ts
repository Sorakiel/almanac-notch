// The sidebar of the settings window (stage 9f): each module is its mascot's face, as in the
// island's stack, and the face says how the module is doing - asleep: not connected; its own
// calm life: working; a frown: something needs the person. The brand row is the app's own mascot.
import { MODULE_COL, type ModuleId } from '@almanac-notch/island';
import { welcomeMascot, type WelcomeMascot } from './welcome-mascot';

/** a face in a 24 px canvas: the stage is drawn at 1/K and its R never goes under 46 */
const K = 0.18;
/** settings page -> the island's module (its colour) */
const MODULE: Record<string, ModuleId> = {
  claude: 'claude',
  calendar: 'cal',
  music: 'music',
  github: 'github',
  vercel: 'vercel',
  notion: 'notion',
  grafana: 'grafana',
  almanac: 'almanac',
};

export type Mood = 'off' | 'ok' | 'bad';

const faces = new Map<string, WelcomeMascot>();

/** the dot's classes the pages already keep ("dot ok", "dot bad", "dot") as a mood */
export function moodOf(dotClass: string): Mood {
  return dotClass.includes(' ok') ? 'ok' : dotClass.includes(' bad') ? 'bad' : 'off';
}

export function setFace(page: string, mood: Mood): void {
  const f = faces.get(page);
  if (!f) return;
  f.setAsleep(mood === 'off');
  f.dress({ col: MODULE_COL[MODULE[page] as ModuleId] ?? null, prop: null, mood: mood === 'bad' ? 'worried' : 'calm' });
}

export function makeFaces(list: HTMLElement): void {
  // the brand: the app's mascot and name, at the top where the window's controls end
  const brand = document.createElement('div');
  brand.className = 'brand';
  const bc = document.createElement('canvas');
  const name = document.createElement('span');
  name.textContent = 'Almanac Notch';
  brand.append(bc, name);
  list.querySelector('.side-drag')?.after(brand);
  welcomeMascot(bc, 0.22).setRunning(true);

  for (const row of list.querySelectorAll<HTMLElement>('.mod[data-module]')) {
    const page = row.dataset.module ?? '';
    const ico = row.querySelector('.ico');
    if (!ico) continue;
    if (!(page in MODULE)) {
      // the island's own pages: a plain line icon, one family with the faces
      ico.classList.add('line');
      continue;
    }
    const cv = document.createElement('canvas');
    cv.className = 'face';
    ico.replaceWith(cv);
    const f = welcomeMascot(cv, K);
    faces.set(page, f);
    f.setRunning(true);
    setFace(page, 'off');
  }
}
