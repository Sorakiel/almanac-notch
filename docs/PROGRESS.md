# Прогресс

Обновляется в конце каждой сессии. Новая сессия начинает с этого файла.

## Сейчас
- Этап: 0 закрыт. Следующий - этап 1 (проверка окна у выреза на Tauri 2).
- Ветка этапа 0: `stage-0-scaffold` (от `master`), не запушена, PR не создан.

## Сделано
- Монорепо на npm workspaces: `packages/island`, `apps/harness`, `apps/desktop`.
  - `packages/island`: пока только `src/sim/rng.ts` - mulberry32 с сидом `0x2545F491`. Тест сверяет его с генератором, который `tools/snapshot.mjs` подменяет в `Math.random` (берёт сниппет прямо из файла), 1000 значений совпадают.
  - `apps/harness`: Vite, порт 5173 (`strictPort`), страница `harness.html` - заглушка до этапа 2.
  - `apps/desktop`: только `package.json`; `npm run desktop:dev` пока пишет «оболочка Tauri - на этапе 1» и выходит с кодом 1.
- TypeScript 6.0 strict (`tsconfig.base.json`, проектные ссылки, `npm run typecheck` = `tsc -b`), ESLint 10 + typescript-eslint strict, Prettier, Vitest 5.
- Корневые скрипты: `dev:harness`, `desktop:dev`, `test`, `typecheck`, `lint`, `format`, `format:check`, `ref:screens`, `ref:clips`, `parity`.
- `npm install && npm test` проходит. tsc, eslint, prettier - чисто (в `tools/` два предупреждения о неиспользуемых переменных, сам `tools/` не трогал).
- Эталон `reference/screens` переснят на этой машине (с разрешения владельца, коммит «Reshoot reference screens on macOS»). Старый был снят в облачном Linux на Playwright 1.56. Отличие старого от нового - только сглаживание текста и фаза движения примерно на кадр (кадры просмотрены глазами). Окружение записано в `reference/INDEX.md`. Ролики не переснимались.
- Критерий `ref:screens`: повторная съёмка против нового эталона - 59 кадров 0.00%, один 0.01% по `compare.mjs`. Побайтно PNG не совпадают: на macOS от прогона к прогону шум сглаживания до ~360 пикселей на кадр. Записал в `docs/PARITY.md`.

## Дальше
- Этап 1 из `docs/PLAN.md`: Tauri-окно с полосой-заглушкой у выреза, клики насквозь, раскрытие при наведении, ширина выреза из системы; видео с Mac и список того, что не вышло.
- Расхождение PARITY.md и README про запуск харнесса в `npm run parity` - решить на этапе 2.

## Грабли и решения
- **Playwright закреплён точно на 1.64.0** (Chromium 1248), эталон снят им на macOS. Другая версия или другая ОС = другой рендер текста = кадры поплывут. Обновлять только вместе с пересъёмкой эталона и с разрешения владельца.
- `npx playwright install` от другой версии Playwright удаляет из общего кэша `~/Library/Caches/ms-playwright` чужие сборки Chromium. Для экспериментов с другой версией ставь браузеры в отдельную папку через `PLAYWRIGHT_BROWSERS_PATH`.
- Старые сборки Chromium (1194 для Playwright 1.56) с CDN Playwright у нас не скачиваются - зависают.
- Варианты запуска `{channel:'chromium'}`, `headless:false`, `channel:'chrome'` дают кадры дальше от эталона (~8%), `--disable-gpu` - то же, что по умолчанию. По умолчанию (headless shell) ближе всего.
- typescript-eslint 8 поддерживает TypeScript только до 6.0, поэтому не 7.x.
- Шрифты прототипа грузятся с Google Fonts; к моменту отрисовки они загружены полностью (проверено `document.fonts`), так что разница не из-за гонки загрузки.
- Ролики `reference/video` записаны с загрузки страницы: первые ~6 с каждого - это приветствие при запуске, нужная сцена идёт после.
