# Архитектура

## Идея в одном абзаце

Весь остров вместе с маскотом - это один канвас, который рисует TypeScript-пакет `packages/island`. Пакет переносится из прототипа почти дословно, только с типами и разбивкой на модули. Этот же пакет работает в трёх местах:

- в dev-харнессе (браузер) - для разработки и сверки с прототипом;
- в окне Tauri у выреза на Mac;
- в окне Tauri у верхнего края на Windows.

Rust отвечает за окно, системные API, секреты и данные модулей. Данные он отдаёт в канвас готовыми снимками. Рисует всегда только TypeScript, поэтому выглядит одинаково везде.

```
almanac-notch/
  packages/island/        рендер и поведение: чистый TS, без React, без DOM кроме <canvas>
    src/util/             math.ts (clamp, ss, hexA, mix), draw.ts (rrect, textAt)
    src/sim/              state.ts (IslandState, after), settings.ts (DEFAULTS, SLIDERS, COLORS), springs.ts, pose.ts,
                          behavior.ts (update: слои, T, шаг пружин), actions.ts (hop, poke, wake), events.ts (EVENTS, trigger,
                          answer, statusOf), mood.ts (moduleMood), particles.ts, music.ts (часы трека), rng.ts
    src/mascot/           shape.ts (BODY, bodyPath, bodyField), body.ts, eyes.ts, hand.ts, badge.ts, marks.ts (дуга, кольца,
                          луч, пузырь, часы), particles.ts (рисование), props/ (реестр + по файлу на предмет)
    src/stage.ts          большая сцена: render и ввод (pointer, drag, dblclick) чистыми функциями, DOM-слушатели в харнессе
    src/island/           focus.ts (notchState, autoFocus, effectiveFocus - нужны поведению маскота), geometry.ts (islandShape, islandTargets - цели ушей и высоты, центровка), render.ts (renderIsland: offscreen 2×, остров, лупа), fx.ts (workFx, орбита, точки, блик, вспышка, тряска, bootTrace), crew.ts (экипаж 2×2), half.ts, input.ts (ввод по острову чистыми функциями, DOM-слушатели в харнессе), open.ts (drawOpen, topBar, icon, drawOpenBody), card.ts (card, cardMascot, cardTint, kbdButton), modules.ts (modules, isHot, primaryItem, idleShort, focusTint, ring, drawGlyph, prIcon), cards.ts (drawFocusCard, drawSteps, drawAsk, drawAlert, drawLaunch), music.ts (drawMusicWide, iconBtn, drawRail), tabs.ts (drawChat, drawAdd, drawSettings), hits.ts
    src/model.ts          типы снимков модулей и событий (контракт с Rust)
    src/stub.ts           заглушки данных из прототипа - для харнесса и тестов
    src/index.ts          createIsland(canvas, opts) -> { setModel, trigger, pointer, key, setScreen, ... }
  apps/harness/           Vite-страница, повторяющая страницу прототипа: #island, #stage, #loupe, панель, кнопки событий, window.__notch
  apps/desktop/           Tauri 2: src-tauri (Rust) + маленький фронт, который монтирует packages/island во всё окно
    src/agent.ts          хуки Claude Code и plan usage -> события острова (AgentDriver), чистая логика с тестами
    src-tauri/src/claude/ сервер хуков (server.rs), ожидание ответов (mod.rs, Hub), plan usage (usage.rs), установщик из трея (hooks_ui.rs)
    hook/                 крейт almanac-hook: клиент хука (std + serde_json) и установщик хуков в settings.json
  prototype/              эталон, не редактировать
  reference/              эталонные кадры и ролики из прототипа
  tools/                  snapshot.mjs, scenes.mjs, compare.mjs
  docs/
```

## packages/island

- **Перенос, а не переписывание.** Функции прототипа переносятся с теми же формулами и константами. Имена можно сделать понятнее, но в JSDoc указывай исходное имя (`/** proto: drawHalf */`), чтобы по прототипу было легко найти.
- **Состояние.** Модули не держат глобальных `let`, как прототип: всё состояние лежит в одном объекте `IslandState`. Время `t` идёт только через `update(dt)`. Случайность - через инжектируемый `rng()`, чтобы тесты были детерминированными.
- **Без React в цикле кадра.** Канвас, `requestAnimationFrame`, шаг пружин 1/240.
- **Плотность пикселей.** Канвас в `devicePixelRatio` (до 2.5). Для лупы - offscreen 2×, как в прототипе.
- **Шрифты.** Onest и JetBrains Mono локально через `@fontsource/*`. Отрисовка ждёт `document.fonts.ready`.
- **Ввод.** Пакет сам считает hit-регионы и отдаёт наружу `hitTest(x, y)` и `islandRect()`. Это нужно окну для «кликов насквозь» вне острова.
- **Отладочное API харнесса** (на нём работает `tools/snapshot.mjs --target port`):

```ts
window.__notch = {
  setScreen(s: 'mac' | 'win'): void,
  setNotchState(s: 'auto' | 'closed' | 'half' | 'open'): void,
  trigger(type: EventType | 'sleep'): void,
  setFocus(id: ModuleId | null): void,
  setTab(tab: 'home' | 'chat' | 'add' | 'settings'): void,
  poke(n: number): void,            // n тычков подряд в точку (0.2, -0.3) тела
  answer(a: 'approve' | 'deny' | `opt:${number}`): void,
}
```

У харнесса те же id элементов, размеры канвасов и раскладка, что у страницы прототипа (`#island` 560×200, `#stage`, `#loupe` 252×120). Иначе кадры не совпадут по размеру.

## apps/desktop (Tauri 2)

### Окно

- Одно прозрачное окно без рамки и тени, поверх всего, не попадает в Dock, панель задач и Alt-Tab. Размер 560×200 pt - как канвас `#island` прототипа, поэтому пределы ушей и ширины открытого острова (они считаются от `IW`) совпадают с эталоном.
- Клики насквозь: окно игнорирует мышь (`set_ignore_cursor_events(true)`). Rust опрашивает глобальную позицию курсора примерно 60 раз в секунду и шлёт её во фронт. Фронт отдаёт курсор пакету как `pointermove` (окно = канвас `#island` прототипа) и снимает игнорирование (`set_interactive`), когда курсор над `islandRect()` или над зоной `hitTest`; иначе включает снова. Так остров получает наведение, даже пока окно «прозрачно» для кликов. В покое (закрыто, без события, курсор далеко) симуляция идёт таймером 10 Гц без отрисовки.
- **Mac:**
  - уровень окна выше строки меню (`NSStatusWindowLevel` или выше);
  - `collectionBehavior`: `canJoinAllSpaces`, `stationary`, `fullScreenAuxiliary`, `ignoresCycle`;
  - геометрия выреза из `NSScreen.safeAreaInsets`, `auxiliaryTopLeftArea`, `auxiliaryTopRightArea` (macOS 12+); ширина выреза идёт в пакет вместо константы 190;
  - на экранах без выреза - режим «Windows» (полоса без камеры) у верхнего края;
  - клик по острову не забирает фокус: видимое окно - своя `NSPanel` (`Borderless | NonactivatingPanel`, публичный API), в неё перенесён contentView окна Tauri с webview; окно Tauri скрыто и держит webview и IPC (проверено на этапе 1: обычное окно Tauri на клик активирует приложение). Фокус, взятый при запуске, возвращается прежнему приложению;
  - курсор - из CoreGraphics (`CGEventGetLocation`, точки, начало сверху слева), опрос 60 Гц рядом с островом и 20 Гц далеко.
- **Windows:**
  - окно по центру у верхнего края основного монитора, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, topmost;
  - учитывать масштаб (Per-Monitor DPI v2);
  - закрытое состояние - плитка 96×9.
- Мониторы: остров на основном экране, позже - выбор в настройках. Смена экранов и разрешения переставляет окно.
- Полноэкранные приложения: на Mac остров виден поверх, если это включено в настройках, по умолчанию прячется.

### Rust-ядро

- **Шина событий:** Rust → фронт `island://event` (`IslandEvent`) и `island://model` (`ModelSnapshot`); фронт → Rust `island://answer` (ответ на подтверждение или вопрос).
- **Claude Code (этап 4):** Rust → фронт `island://agent` (урезанный payload хука или `resolved`) и `island://usage`; фронт → Rust команда `agent_answer(id, answer)`. Хуки в события острова превращает `apps/desktop/src/agent.ts` (`AgentDriver`), живые данные лежат в `s.agent` пакета. Пока `s.agent` равен `null`, пакет рисует заглушки прототипа (харнесс, parity).
- **Сервер хуков Claude Code** (`src-tauri/src/claude`):
  - HTTP только на `127.0.0.1`, случайный порт. Токен - 32 случайных байта на запуск, заголовок `X-Almanac-Token`, сравнение за постоянное время. Запросы с `Origin` (так шлют браузеры) или с чужим `Host` (DNS rebinding) отклоняются. Заголовки до 16 КБ, тело до 1 МБ, чтение не дольше 5 с, не больше 64 соединений.
  - Порт и токен лежат в `<app data>/hook.json` (права 0600, каталог 0700), при выходе файл удаляется. На Mac `<app data>` = `~/Library/Application Support/dev.almanac.notch`.
  - Хук - отдельный бинарник `almanac-hook` (крейт `apps/desktop/hook`, ~400 КБ, только libSystem, старт ~5 мс). Он пересылает stdin серверу и печатает ответ. Нет файла, порт закрыт, ответ кривой или медленный - хук молча выходит с кодом 0, и Claude Code работает как без хука. Обычные события ждут не больше 2 с.
  - Хуки: `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop`, `StopFailure`, `SessionEnd`.
  - Разрешение команды идёт через `PermissionRequest`, а не через `PreToolUse`. `PreToolUse` срабатывает на каждый вызов ещё до правил доступа, и «разрешить» в нём обходило бы настройки пользователя. `PermissionRequest` приходит только тогда, когда Claude Code сам собирается спросить.
  - Вопрос - `PreToolUse` инструмента `AskUserQuestion`, ответ уходит как `updatedInput.answers`. Остров отвечает только на один вопрос с одиночным выбором, остальные Claude Code задаёт в терминале.
  - Сервер держит такой хук до ответа острова, не дольше 30 с, как в прототипе. Без ответа хук ничего не возвращает, и Claude Code показывает свой обычный диалог. Если на вопрос ответили в терминале или в окне Desktop, Claude Code завершает процесс хука: сервер видит закрытый сокет (проверка раз в 200 мс) и снимает вопрос с острова. Запасной путь - следующий хук той же сессии и того же субагента.
  - Во фронт уходит урезанный payload: без содержимого файлов, вывода команд и длинных строк. Для правок Rust считает только +/− строк.
  - Установщик (трей «Установить хуки Claude Code…» или `almanac-hook install`) копирует клиент в `<app data>` и добавляет наши записи в `~/.claude/settings.json`. Чужие хуки и настройки он не трогает. Перед записью показывает дифф и делает бэкап `settings.json.bak-almanac-<unix>`, пишет атомарно. Если файл изменился после показа диффа, установка отказывается. Свои записи узнаёт по `almanac-hook` в команде. Удаление - тем же путём.
- **Модули** - отдельные провайдеры с общим трейтом. Каждый можно выключить, приложение работает без любого из них:

```rust
trait Provider {
    fn id(&self) -> ModuleId;
    async fn start(&self, tx: Sender<ProviderMsg>);
    fn snapshot(&self) -> ModuleSnapshot;
}
```

- **Секреты** - только в Keychain (Mac) и Credential Manager (Windows), через крейт `keyring`. В файлах настроек токенов нет.
- **Настройки** - JSON в каталоге приложения, тот же набор, что панель прототипа, плюс модули.

### Источники данных (план, детали решаются на своём этапе)

| модуль | источник |
|---|---|
| Claude Code | хуки (выше), шаги из PreToolUse и PostToolUse: инструмент, файл, +/− для правок |
| Plan usage | хвосты (256 КБ) свежих `~/.claude/projects/*/*.jsonl` раз в 20 с и сразу после `Stop`/`StopFailure`. Если последнее сообщение ассистента - `"error": "rate_limit"` («resets 7pm (Europe/Moscow)»), остров показывает «Лимит» с таймером до сброса. Время сброса разбирает фронт через Intl. Название плана - `oauthAccount.organizationType` из `~/.claude.json`, читается только это поле. Сети нет |
| Календарь | Mac - EventKit (с разрешением). Windows - решить позже: Outlook, Google или выключено |
| Музыка | Mac - текущий плеер через MediaRemote (приватный фреймворк, через хелпер) или через AppleScript для Music и Spotify. Windows - SMTC (`GlobalSystemMediaTransportControls`). Обложка - реальная, своя сгенерированная остаётся запасной |
| GitHub | fine-grained токен на выбранные репозитории, GraphQL: статус CI последнего коммита, PR на ревью, коммиты за 7 дней |
| Almanac | необязательный провайдер: локальное API или файл Almanac. Без Almanac модуль просто не показывается |

## Приватность (обязательные правила)

- Никакой телеметрии, аналитики и отчётов о падениях наружу.
- Сеть - только к сервисам, которые пользователь сам подключил. Шрифты и картинки - локально.
- Сервер хуков слушает только `127.0.0.1`, с токеном.
- Секреты только в системном хранилище.
- Всё, что модуль читает, видно в настройках модуля: «что читается и куда ходит».
- Claude Code. Читает: payload хуков (в окно попадает урезанным), хвосты `~/.claude/projects/*/*.jsonl` (только время и признак лимита), одно поле `~/.claude.json`. Пишет: `~/.claude/settings.json` (только после подтверждения, с бэкапом), `<app data>/hook.json`, `<app data>/almanac-hook`. Сети нет.

## Запасной путь

Если на этапе 1 окажется, что Tauri не даёт нужного окна на Mac (уровень над меню-баром, клики насквозь, все рабочие столы), оболочку на Mac делаем нативной: Swift, `NSPanel` и `WKWebView`, в котором тот же бандл `packages/island`. Windows остаётся на Tauri. Рендер при этом не меняется - ради этого он и сделан независимым от оболочки.
