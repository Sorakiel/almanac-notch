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

/** proto: calMins - minutes to the next call */
export function calMins(t: number): number {
  return 14 - (Math.floor(t / 40) % 14);
}

/** proto: limitLeft - plan usage reset timer, from the start of the ratelimit event */
export function limitLeft(el: number): string {
  const left = Math.max(0, 84 - Math.floor(el));
  return Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
}
