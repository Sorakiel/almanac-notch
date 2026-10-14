// Stub data from the prototype. In the app these come from module providers (docs/SPEC.md, section 6).

export type ToolKind = 'read' | 'edit' | 'bash' | 'grep';
export type Step = readonly [ToolKind, string, string, string?, string?];

/** proto: STEPS - in the app they come from the PreToolUse / PostToolUse hooks */
export const STEPS: readonly Step[] = [
  ['read', 'Читает', 'notch.rs'],
  ['edit', 'Правит', 'island.ts', '+12', '−3'],
  ['bash', 'Запускает', 'npm test'],
  ['edit', 'Правит', 'mascot.ts', '+41', '−12'],
  ['grep', 'Ищет', '"rrect("'],
  ['read', 'Читает', 'package.json'],
];
/** proto: STEP_LEN */
export const STEP_LEN = 1.7;

/** proto: TRACKS */
export const TRACKS: readonly (readonly [string, string])[] = [
  ['Lo-fi Radio', 'плейлист дня'],
  ['Ночной джаз', 'подборка'],
  ['Synthwave mix', 'радио'],
];
/** proto: TRACK_LEN */
export const TRACK_LEN: readonly number[] = [187, 214, 243];

/** proto: HABITS (initial; the island toggles them) */
export function initialHabits(): [string, boolean][] {
  return [
    ['Зарядка', true],
    ['Вода 2 л', true],
    ['Чтение 20 мин', false],
    ['Английский', true],
    ['Сон до 0:00', false],
  ];
}

/** proto: PREFS (initial; the settings tab toggles them) */
export function initialPrefs(): [string, boolean][] {
  return [
    ['Звуки', true],
    ['Запуск при входе', true],
    ['Открывать при наведении', false],
  ];
}

/** proto: calMins - minutes to the next call */
export function calMins(t: number): number {
  return 14 - (Math.floor(t / 40) % 14);
}

/** proto: limitLeft - plan usage reset timer, from the start of the ratelimit event */
export function limitLeft(el: number): string {
  return clockLeft(84 - Math.floor(el));
}

/** m:ss like limitLeft; h:mm:ss once a real reset is an hour or more away */
export function clockLeft(sec: number): string {
  const left = Math.max(0, Math.floor(sec)),
    pad = (n: number): string => String(n).padStart(2, '0');
  if (left < 3600) return Math.floor(left / 60) + ':' + pad(left % 60);
  return Math.floor(left / 3600) + ':' + pad(Math.floor(left / 60) % 60) + ':' + pad(left % 60);
}
