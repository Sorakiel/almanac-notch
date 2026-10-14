// Tuning values shared by the harness panel and, later, the app's settings tab.

export interface Settings {
  color: string;
  screen: string;
  workfx: string;
  nstate: string;
  eyeSize: number;
  notchEye: number;
  bodyK: number;
  bodyZ: number;
  eyeK: number;
  eyeZ: number;
  exprK: number;
  exprZ: number;
  lookRange: number;
  pokeForce: number;
  blinkEvery: number;
  sleepAfter: number;
  breath: number;
  timeScale: number;
  reduced: boolean;
  debug: boolean;
}

/** proto: DEFAULTS (reduced comes from prefers-reduced-motion at load) */
export function defaultSettings(reduced = false): Settings {
  return {
    color: 'chalk',
    screen: 'mac',
    workfx: 'orbit',
    nstate: 'auto',
    eyeSize: 1.3,
    notchEye: 1.3,
    bodyK: 320,
    bodyZ: 0.42,
    eyeK: 260,
    eyeZ: 0.78,
    exprK: 200,
    exprZ: 0.85,
    lookRange: 1,
    pokeForce: 1,
    blinkEvery: 3.6,
    sleepAfter: 30,
    breath: 1,
    timeScale: 1,
    reduced,
    debug: false,
  };
}

/** proto: KEY */
export const SETTINGS_KEY = 'notch-mascot-v3';

/** proto: settings load at startup - only known keys with the default's type are taken */
export function loadSettings(storage: Storage | null, reduced = false): Settings {
  const S = defaultSettings(reduced);
  try {
    const saved: unknown = JSON.parse(storage?.getItem(SETTINGS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const rec = saved as Record<string, unknown>,
        out = S as unknown as Record<string, unknown>;
      for (const k in out) if (k in rec && typeof rec[k] === typeof out[k]) out[k] = rec[k];
    }
  } catch {
    // corrupt storage: keep defaults
  }
  return S;
}

/** proto: save */
export function saveSettings(storage: Storage | null, S: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(S));
  } catch {
    // storage full or blocked
  }
}

export type SliderKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

export interface Slider {
  g: 'eyes' | 'springs' | 'behave';
  id: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  f: (v: number) => string;
}

/** proto: SLIDERS */
export const SLIDERS: readonly Slider[] = [
  { g: 'eyes', id: 'eyeSize', label: 'Размер глаз', min: 0.6, max: 1.6, step: 0.01, f: (v) => '×' + v.toFixed(2) },
  { g: 'eyes', id: 'notchEye', label: 'Добавка в нотче', min: 1, max: 1.8, step: 0.01, f: (v) => '×' + v.toFixed(2) },
  { g: 'springs', id: 'bodyK', label: 'Тело - жёсткость', min: 60, max: 900, step: 5, f: (v) => v.toFixed(0) },
  { g: 'springs', id: 'bodyZ', label: 'Тело - затухание', min: 0.08, max: 1.2, step: 0.01, f: (v) => v.toFixed(2) },
  { g: 'springs', id: 'eyeK', label: 'Взгляд - жёсткость', min: 40, max: 800, step: 5, f: (v) => v.toFixed(0) },
  { g: 'springs', id: 'eyeZ', label: 'Взгляд - затухание', min: 0.2, max: 1.2, step: 0.01, f: (v) => v.toFixed(2) },
  { g: 'springs', id: 'exprK', label: 'Эмоции - скорость', min: 40, max: 600, step: 5, f: (v) => v.toFixed(0) },
  { g: 'springs', id: 'exprZ', label: 'Эмоции - затухание', min: 0.3, max: 1.2, step: 0.01, f: (v) => v.toFixed(2) },
  { g: 'behave', id: 'lookRange', label: 'Размах взгляда', min: 0.2, max: 1.4, step: 0.01, f: (v) => v.toFixed(2) },
  { g: 'behave', id: 'pokeForce', label: 'Сила тычка', min: 0.2, max: 2, step: 0.01, f: (v) => v.toFixed(2) },
  { g: 'behave', id: 'blinkEvery', label: 'Моргает раз в', min: 1, max: 8, step: 0.1, f: (v) => v.toFixed(1) + ' с' },
  { g: 'behave', id: 'sleepAfter', label: 'Засыпает через', min: 10, max: 120, step: 1, f: (v) => v.toFixed(0) + ' с' },
  { g: 'behave', id: 'breath', label: 'Дыхание', min: 0, max: 2, step: 0.01, f: (v) => v.toFixed(2) },
  {
    g: 'behave',
    id: 'timeScale',
    label: 'Скорость времени',
    min: 0.1,
    max: 1,
    step: 0.01,
    f: (v) => '×' + v.toFixed(2),
  },
];

export interface MascotColor {
  name?: string;
  body: string;
  shade: string;
  eye: string;
}

/** proto: COLORS */
export const COLORS: Readonly<Record<string, MascotColor>> = {
  chalk: { name: 'Мел', body: '#EEEDE8', shade: '#B9B7AE', eye: '#16171A' },
  steel: { name: 'Сталь', body: '#B5BDC6', shade: '#76808C', eye: '#101317' },
  signal: { name: 'Сигнал', body: '#FF7A3D', shade: '#C24E19', eye: '#190F0A' },
  ice: { name: 'Лёд', body: '#AEDBEA', shade: '#68A9C1', eye: '#0D1A21' },
  graphite: { name: 'Графит', body: '#5B6069', shade: '#32363D', eye: '#F3F2EE' },
};
export const CHALK: MascotColor = { name: 'Мел', body: '#EEEDE8', shade: '#B9B7AE', eye: '#16171A' };

/** proto: isLight */
export const isLight = (key: string): boolean => key === 'chalk' || key === 'ice' || key === 'steel';
