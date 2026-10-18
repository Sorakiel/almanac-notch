import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN, tr } from './i18n';

// Harness-only text (the debug panel, layer captions, mood names) stays Russian: the app never shows it.
const HARNESS_ONLY = ['sim/settings.ts', 'sim/behavior.ts', 'sim/mood.ts', 'mascot/props/', 'sim/state.ts'];
// EVENTS labels are harness layer captions; Russian commit forms have an English branch of their own
const LABELS = [
  'ждёт подтверждения',
  'вопрос',
  'лимит',
  'успех',
  'ошибка',
  'празднует',
  'просыпается',
  ' коммит',
  ' коммита',
  ' коммитов',
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('i18n.ts') ? [p] : [];
  });
}

describe('i18n', () => {
  it('Russian is the key itself', () => {
    const s = { lang: 'ru' as const };
    for (const k of Object.keys(EN)) if (!k.includes('{')) expect(tr(s, k)).toBe(k);
    expect(tr(s, 'созвон через {0}', '5 мин')).toBe('созвон через 5 мин');
    expect(tr(s, 'привычки {0} из {1}', 3, 5)).toBe('привычки 3 из 5');
  });

  it('English fills arguments and passes unknown text through', () => {
    const s = { lang: 'en' as const };
    expect(tr(s, 'привычки {0} из {1}', 3, 5)).toBe('habits 3 of 5');
    expect(tr(s, 'Lo-fi Radio')).toBe('Lo-fi Radio');
    expect(tr(s, 'CI прошёл · almanac')).toBe('CI прошёл · almanac');
  });

  it('every Russian string the island draws has an English line', () => {
    const root = join(__dirname);
    const missing: string[] = [];
    for (const f of sources(root)) {
      const rel = f.slice(root.length + 1);
      if (HARNESS_ONLY.some((h) => rel.startsWith(h))) continue;
      const code = readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
      for (const m of code.matchAll(/'([^'\n]*[А-Яа-яЁё][^'\n]*)'/g)) {
        const ru = m[1] as string;
        if (!(ru in EN) && !LABELS.includes(ru)) missing.push(rel + ': ' + ru);
      }
    }
    expect(missing).toEqual([]);
  });
});
