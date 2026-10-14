# Прогресс

Обновляется в конце каждой сессии. Новая сессия начинает с этого файла.

## Сейчас
- Этап: 2b (остров: геометрия, состояния, полуоткрыто) - сделан, ждёт ответа владельца. Следующий - 2c (карточки, вкладки, плеер, приветствие).
- Ветки: `stage-0-scaffold` (от `master`), `stage-1-window` (от `stage-0-scaffold`), `stage-2a-mascot` (от `stage-1-window`), `stage-2b-island` (от `stage-2a-mascot`). Не запушены, PR не созданы, в `master` ничего не влито.

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

### Этап 1 (ветка `stage-1-window`)
- `apps/desktop`: Tauri 2.12 (`src-tauri`) + Vite-фронт на порту 1420 (`src/main.ts`) - чёрная полоса-заглушка на канвасе, раскрывается в 480×150 при наведении. Анимация - временный lerp, не пружины прототипа. `npm run desktop:dev` из корня.
- Rust: `src/lib.rs` (состояние, команды `island_geometry` и `set_hit_rects`, поток опроса курсора, сторож), `src/platform/{macos,windows,other}.rs`.
- Окно 520×190 pt, прозрачное, без рамки и тени, `skipTaskbar`, `visible:false` до расстановки, показывается `orderFrontRegardless` (без активации).
- Mac (проверено владельцем на MacBook Air M4, macOS 27):
  - уровень 25 (`kCGStatusWindowLevel`), строка меню - 24, окно над ней; `canJoinAllSpaces | stationary | fullScreenAuxiliary | ignoresCycle`; политика `Accessory` - нет в Dock и Cmd-Tab;
  - вырез из `NSScreen` (первый экран = экран со строкой меню): ширина = промежуток между `auxiliaryTopLeftArea` и `auxiliaryTopRightArea`, высота = `safeAreaInsets.top`. На этой машине 185×33.5 pt. Без выреза - плитка 96×9 у верхнего края (проверено только кодом);
  - фактическая рамка после показа совпадает с заданной (595, 0, 520×190), система не сдвигает окно вниз - пишется в лог `[island] placed`;
  - клики насквозь: окно по умолчанию игнорирует мышь; поток опрашивает курсор через `CGEventCreate`/`CGEventGetLocation` (точки, начало сверху слева, можно не с главного потока) - 60 Гц рядом с островом (120 pt от открытого прямоугольника), 20 Гц далеко. Вход - по закрытому прямоугольнику (вырез), выход - по открытому. Владелец: наведение, клики насквозь, сон и блокировка - работают;
  - фокус: клик по полосе не забирает фокус (проверено владельцем с TextEdit и Заметками). Как: видимое окно - своя `NSPanel`, созданная публичным API со стилем `Borderless | NonactivatingPanel`; в неё перенесён `contentView` окна Tauri (с WKWebView), окно Tauri скрыто и держит webview и IPC. Приватного API нет. Клики насквозь переключаются через `platform::set_ignore` на панели (не `window.set_ignore_cursor_events` - тот бьёт в скрытое окно Tauri). При запуске tao и wry активируют приложение - через 0.8 с фокус возвращается приложению, которое было впереди до старта (проверено `lsappinfo front`);
  - закрытое состояние на экране с вырезом не рисуется вовсе (SPEC: «остаётся только чёрный вырез») - иначе при смене рабочего стола был виден чёрный прямоугольник (замечание владельца);
  - сторож раз в 2 с на главном потоке: экран, рамка, видимость, уровень - при расхождении окно переставляется (сон, блокировка, смена мониторов);
  - CPU в простое: 0.1% `almanac-notch`, 0% WebContent (Мониторинг системы, debug-сборка). Без анимации rAF не крутится.
- Windows: код есть (`WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST`, Per-Monitor DPI v2, верхний край основного монитора, `GetCursorPos` в физических пикселях, масштаб из `GetDpiForWindow`). Проверен только `cargo check --target x86_64-pc-windows-msvc`; запуска не было - нет виртуалки.
- Видео приёмки владелец решил не делать.

### Этап 2a (ветка `stage-2a-mascot`)
- `packages/island/src` - перенос маскота: `util/`, `sim/` (state, settings, springs, pose, behavior, actions, events, mood, particles, music), `mascot/` (shape, body, eyes, hand, badge, marks, particles, props/ - headphones, book, terminal, diff, calendar), `island/focus.ts` (notchState, autoFocus, effectiveFocus, claudeState - их читает поведение), `stage.ts` (рендер сцены и ввод), `stub.ts`, `index.ts` (`createMascot`). Структура - в ARCHITECTURE.
- Все глобальные `let` прототипа лежат в одном `IslandState`; время - только `update(dt, now)`, случайность - только `s.rng` (свой экземпляр `mulberry32(PARITY_SEED)` в харнессе). Тест проверяет, что `Math.random` не вызывается. Порядок вызовов `rng` как в прототипе (порядок свойств в `burst` важен).
- Не перенесено как мёртвый код (SPEC 6): `waveUntil` (T.hand = 0), `greetFlash`, `S.style`. `drawOrbit` (орбита «работает» вокруг маскота в острове) и `mascotMarks` - в 2b вместе с островом, на сцене орбита рисуется `drawOverhead`.
- `apps/harness/harness.html` - копия разметки и стилей прототипа (строки 1-179) с локальными шрифтами `@fontsource/*` (Onest, JetBrains Mono, Unbounded). Панель (слайдеры, цвета, переключатели, копирование, сброс), кнопки событий и клавиши, плашки слоёв, `window.__notch` (`setScreen`, `setNotchState`, `trigger`, `setFocus`, `setTab`, `poke`, `answer`). `#island` и `#loupe` пока пустые.
- `npm run parity` теперь сам собирает харнесс и поднимает `vite preview` на 5174 (`tools/parity.mjs`), README и PARITY поправлены. `parity:shoot` по-прежнему снимает dev-сервер на 5173.
- Результат: все 10 кадров маскота (`stage-*` и `overload-1.2s-stage`) - 0 отличающихся пикселей. Остальные 50 кадров (остров, лупа, страница) красные - это 2b-2d.
- Поведение, которого нет в сценах, сверено отдельным скриптом (прототип и харнесс, одинаковые движения мыши, кадры сцены): слежение за курсором, перетаскивание и бросок, поглаживание, двойной клик, тычок - 0 пикселей, тексты слоёв совпадают. Скрипт не в репо (в сцены `tools/scenes.mjs` не добавлял: это поменяло бы эталон). Предложить владельцу добавить такие сцены в 2d.
- Тесты (18): пружина по формуле, сходимость всех групп, перелёт/без перелёта, таблица групп SPEC 1.3, гравитация и отскок `posY`, высота прыжка, детерминизм (один сид - одно состояние, другой - другое, без `Math.random`), приветствие 0.5 с + 4.6 с, моргание, 3 тычка - дуется, 6 - перегруз и перезагрузка, сон через 30 с и пробуждение, бесконечные события выключаются повтором, «Разрешить» через 0.55 с - работа.
- Пункты чек-листа PARITY «Маскот», которые проверены только на сцене: форма, дыхание, пружины, глаза (кроме добавки в нотче и карточке), точка статуса, слежение, тычки, перегруз на сцене, двойной клик, поглаживание, перетаскивание, сон, частицы. Добавка глаз 1.3/1.12, часы в нотче, предметы в карточках, рука в приветствии видны только в острове - проверить в 2b/2c.

### Этап 2b (ветка `stage-2b-island`)
- `packages/island/src/island/`: `geometry.ts` (`MB`, `NOTCH_W`, `islandShape`, `islandTargets` - блок целей `earL/earR/ih/nw` из `renderIsland`, вынесен чистой функцией для тестов, формулы те же), `fx.ts` (`workFx`, `drawOrbit`, `drawWaveDots`, `drawShine`, `islandFlash`, `shakeX`, `bootTrace`), `crew.ts` (`STATE_COL`, `miniCrew`, `drawMini`), `hits.ts` (`addHit`, `hovering`, `hitAt`, `button`), `half.ts` (`drawHalf`, `approvalBlock`, `T_MUTED`), `render.ts` (`renderIsland`), `input.ts` (обработчики `#island`: move/leave/down/dblclick), `open.ts` - пустая заглушка `drawOpen` до 2c. `mascotMarks` - в `mascot/marks.ts`.
- `IslandState`: добавлены `IW, IH, islandBox, mascotSpots, hits, loupeRect, muted, volume, prefs` (+ `initialPrefs` в `stub.ts`). Все ветки `pointerdown` прототипа перенесены сразу (вкладки, музыка, привычки, настройки) - в 2c их надо только вызвать из карточек через `addHit`.
- `renderIsland(s, ic, oc, lc)`: пакет не создаёт канвасы, offscreen (IW·2 × IH·2) создаёт харнесс. `createMascot().renderIsland(ic, oc, lc)`.
- Харнесс: `resize` пишет `s.IW/IH` и размер offscreen, слушатели на `#island` с `islandPoint`, `renderIsland` после сцены в `frame`.
- Результат `npm run parity`: `mac-closed`, `win-closed-tile`, все `half-*` и `half-*-loupe`, `win-half-working` - 0.00%; `stage-*`, `overload-1.2s-stage`, `overload-after`, `page` - 0.00%. Красные только `open-*`, `greeting-*` (кроме 0300), `overload-0.3s/1.2s` - это `drawOpen`, 2c.
- Опасение из плана не подтвердилось: в `half-after-launch` и `mac-closed` хвост `openA` пустой `drawOpen` не портит.
- Ввод по острову сверен скриптом (не в репо, как в 2a): наведение и слежение из маскота острова, тычок, 3 тычка - «Дуется», двойной клик, «Разрешить» и «Отклонить» кликом (с подсветкой кнопки при наведении), пробуждение наведением, «Авто» открывается наведением и закрывается уходом курсора - 0-5 пикселей на кадр, курсор `pointer` над хитами совпадает. Координаты кликов считать от ширины `#island` (560 CSS px на 1280×900), а не сцены.
- Тесты (+21, всего 39): `notchState` - ручные режимы и 6 правил «Авто» по порядку; `islandTargets` - уши 44/50/52, центровка, предел `IW/2−NW/2−10`, drop (44, MB+54), открыто 480×150 и `IW−24`, закрытое Mac/Windows 96×9, ширина выреза; `islandShape` - путь по точкам; `shakeX` по формуле.
- Пункты PARITY «Остров», которые закрывает 2b (отметить в PR): три состояния и «Авто», Mac-вырез, Windows-плитка, центровка, пружинные переходы и кроссфейд, вспышка/тряска/bootTrace (bootTrace видна только в приветствии - кадр `greeting-0300` 0.71%, остальное приветствие - 2c), полуоткрыто целиком, добавка глаз в нотче, курсор-указатель.

## Дальше
- Ответ владельца на отчёт 2b, затем 2c: `drawOpen`, `topBar`, `drawOpenBody`, карточки (`drawFocusCard`, `drawMusicWide`, `drawRail`, `drawAsk`, `drawAlert`, `drawLaunch`, `drawSteps`), вкладки (`drawChat`, `drawAdd`, `drawSettings`), `cardMascot`, `cardTint`, `kbdButton`, `drawGlyph`/`ring`, `modules`, `primaryItem`. Заглушка - `packages/island/src/island/open.ts`.
- Windows: запустить на живой машине или виртуалке (на этапе 7 или раньше, если появится Windows).
- Поведение в полноэкранных приложениях: сейчас `fullScreenAuxiliary` - остров виден поверх. В ARCHITECTURE по умолчанию «прячется» - решить вместе с вопросом из DECISIONS.

## Грабли и решения
- **Playwright закреплён точно на 1.64.0** (Chromium 1248), эталон снят им на macOS. Другая версия или другая ОС = другой рендер текста = кадры поплывут. Обновлять только вместе с пересъёмкой эталона и с разрешения владельца.
- `npx playwright install` от другой версии Playwright удаляет из общего кэша `~/Library/Caches/ms-playwright` чужие сборки Chromium. Для экспериментов с другой версией ставь браузеры в отдельную папку через `PLAYWRIGHT_BROWSERS_PATH`.
- Старые сборки Chromium (1194 для Playwright 1.56) с CDN Playwright у нас не скачиваются - зависают.
- Варианты запуска `{channel:'chromium'}`, `headless:false`, `channel:'chrome'` дают кадры дальше от эталона (~8%), `--disable-gpu` - то же, что по умолчанию. По умолчанию (headless shell) ближе всего.
- typescript-eslint 8 поддерживает TypeScript только до 6.0, поэтому не 7.x.
- Шрифты прототипа грузятся с Google Fonts; к моменту отрисовки они загружены полностью (проверено `document.fonts`), так что разница не из-за гонки загрузки.
- Ролики `reference/video` записаны с загрузки страницы: первые ~6 с каждого - это приветствие при запуске, нужная сцена идёт после.
- **Tauri и фокус на Mac.** Обычное окно Tauri при клике активирует приложение: активацию присылает WindowServer (`-[NSApplication _handleActivatedEvent:]`), в процессе никто `activate` не вызывает. Не помогает ни `NSWindowStyleMaskNonactivatingPanel` на готовом окне, ни подмена класса на NSPanel (как в tauri-nspanel): тег «не активировать» AppKit ставит только при создании NSPanel с этим стилем. Помогал приватный `_setPreventsActivation:`, но выбран публичный путь - своя NSPanel с перенесённым contentView (см. выше). Методы окна Tauri (`set_position`, `set_size`, `show`, `set_ignore_cursor_events`) действуют на скрытое окно - всё про видимое окно делать через `platform::*` на панели.
- Клавиатура в острове (вкладка чата): панель сейчас никогда не становится key (borderless + `becomesKeyOnlyIfNeeded`). Для ввода текста её надо будет временно делать key - non-activating панель может быть key, не активируя приложение.
- `NSEvent.mouseLocation` - снизу слева и только с главного потока; поэтому курсор берётся из CoreGraphics (сверху слева), а рамка окна переводится из координат AppKit через высоту первого экрана.
- `cargo check` под Windows на Mac: нужна цель `rustup target add x86_64-pc-windows-msvc`; `tauri-build` требует `llvm-rc`, для проверки без линковки хватает заглушки, которая создаёт пустой `.res` (её нет в репо, скрипт - в отчёте этапа 1).
- Терминалу Claude не выданы права Accessibility и записи экрана: синтезировать клики и снимать экран из сессии нельзя, ручные проверки делает владелец. Окна и уровни можно смотреть через `CGWindowListCopyWindowInfo` (Swift-скрипт), передний план - `lsappinfo front`.
- **Dev-сервер Vite и кадры.** Если модуль харнесса менялся незадолго до загрузки страницы, HMR-клиент перезагружает её посреди сцены (под виртуальными часами) - кадры сдвигаются, первый прогон после правки «красный», второй чистый. Поэтому `npm run parity` снимает сборку через `vite preview` (5174). `spawnSync` в `tools/parity.mjs` нельзя: preview-сервер живёт в том же процессе и перестаёт отвечать.
- **Мышь под виртуальными часами.** `page.mouse.move(..., {steps})` шлёт все шаги без продвижения часов - скорость курсора для прототипа бесконечная, поглаживание не включается. Для медленных движений - по одному шагу и `clock.runFor(16)` между ними.
- Размер сцены задаёт CSS страницы (на 1280×900 - 758×420 pt), поэтому разметка харнесса - точная копия прототипа. Менять её нельзя без пересъёмки, иначе кадры сцены разъедутся.
