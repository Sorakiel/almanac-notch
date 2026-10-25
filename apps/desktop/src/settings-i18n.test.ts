import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '@almanac-notch/island';
import { SETTINGS_EN, count, setLang, t } from './settings-i18n';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const CYR = /[А-Яа-яЁё]/;
// language names stay in their own language
const KEEP = ['Русский'];

describe('settings window in English', () => {
  it.each(['settings.html', 'bye.html', 'setup.html'])('every Russian text of %s has an English line', (page) => {
    const html = readFileSync(join(__dirname, '..', page), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const texts = [
      ...html.split(/<[^>]*>/).map(norm),
      ...[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/g)].map((m) => norm(m[1] as string)),
    ].filter((x) => CYR.test(x) && !KEEP.includes(x));
    expect(texts.filter((x) => !(x in SETTINGS_EN) && !(x in EN))).toEqual([]);
  });

  it.each(['settings.ts', 'settings-prefs.ts', 'bye.ts', 'setup.ts'])(
    'every t() text of %s has an English line',
    (file) => {
      const code = readFileSync(join(__dirname, file), 'utf8');
      const missing = [...code.matchAll(/'([^'\n]*[А-Яа-яЁё][^'\n]*)'/g)]
        .map((m) => m[1] as string)
        .filter((x) => !(x in SETTINGS_EN) && !(x in EN) && !/^(репозитори|встреч)/.test(x));
      expect(missing).toEqual([]);
    },
  );

  it('switches and counts', () => {
    setLang('en');
    expect(t('Подключено: {0} за 48 ч', count(3, ['встреча', 'встречи', 'встреч'], ['meeting', 'meetings']))).toBe(
      'Connected: 3 meetings in 48 h',
    );
    setLang('ru');
    expect(t('Подключено: {0} за 48 ч', count(3, ['встреча', 'встречи', 'встреч'], ['meeting', 'meetings']))).toBe(
      'Подключено: 3 встречи за 48 ч',
    );
  });
});
