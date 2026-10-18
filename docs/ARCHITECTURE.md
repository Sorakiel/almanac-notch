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
  - клики насквозь - свои биты `WS_EX_TRANSPARENT | WS_EX_LAYERED` (`platform/windows.rs`, `set_ignore`), не `set_ignore_cursor_events` из tao: tao на каждый вызов собирает `GWL_EXSTYLE` заново из своих флагов и стирает `WS_EX_TOOLWINDOW` и `WS_EX_NOACTIVATE`. Сторож раз в 2 с сверяет расширенный стиль и возвращает его, если tao всё же переписал;
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
  - Вопрос - `PreToolUse` инструмента `AskUserQuestion`, ответ уходит как `updatedInput.answers`. Анкету из 1-4 вопросов с одиночным выбором остров задаёт по очереди («2/4 · …», по 30 с на вопрос) и отправляет все ответы разом. Вопросы с несколькими вариантами (multiSelect) остаются у Claude Code. Пока остров держит анкету, Claude Code ждёт и свой вопрос не показывает; если 30 с нет ответа, анкета уходит в окно Claude Code целиком. Других хуков у AskUserQuestion нет: `PermissionRequest` для него не приходит (проверено). Таймаут `PreToolUse` в settings - 130 с.
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
| Календарь | Mac - EventKit (`src-tauri/src/calendar.rs`): полный доступ к событиям, запрос при запуске и из трея («Доступ к календарю…», после отказа открывает Системные настройки). Раз в 30 с - события со временем на 48 ч → `island://calendar` (только название и время). Фронт `apps/desktop/src/feeds.ts` (`CalDriver`) выбирает ближайший созвон → `s.cal`. Описание доступа - `src-tauri/Info.plist`. Windows - источник выбирается в окне настроек (раздел «Календарь»): классический Outlook, ссылка iCal или ничего; выбор в `<app data>/calendar.json` (`mod choice` в `calendar.rs`). Outlook - COM без привязки типов (`src/outlook.rs`, IDispatch): календарь по умолчанию, `IncludeRecurrences` + `Restrict` по датам в формате локали пользователя; запущенный Outlook читается раз в 30 с, незапущенный поднимается без окна не чаще раза в 5 мин. Новый Outlook COM не даёт - тогда «Outlook не найден». iCal (`src/ical.rs`) - GET по ссылке раз в 5 мин (`ureq`, до 32 МБ), разбор своими силами: события со временем, RRULE (крейт `rrule`), EXDATE, RDATE, перенесённые повторы (RECURRENCE-ID), отменённые; отклонённые - если календарь называет владельца (у Google `X-WR-CALNAME` = адрес). Пояса - IANA через `chrono-tz`, Windows-имена Outlook.com - по таблице, неизвестные - стандартное смещение из VTIMEZONE. Сообщение то же, плюс `source` (`system`, `outlook`, `ical`, `none`) - по нему фронт пишет, что сломалось. Команды `calendar_config`, `calendar_choose(source, url)` (проверяет и считает встречи на 48 ч), `calendar_access` |
| Музыка | Mac - MediaRemote. С macOS 15.4 он отвечает только программам Apple, поэтому библиотека `src-tauri/media/mediaremote.m` (собирает build.rs через clang, вшита в бинарник, пишется в `<app data>/libalmanac_media.dylib`) загружается в системный `/usr/bin/perl` (`com.apple.perl`), как в mediaremote-adapter. Один процесс: JSON-строки на каждое изменение (обложка - JPEG до 160 px, только когда сменилась; иконка плеера PNG - один раз на плеер, запасная обложка; если браузер отдаёт её позже - повторное чтение через 1.5, 3, 6 с), команды через stdin; конец stdin = выход. Упал трижды подряд быстрее 10 с - модуль «Музыка недоступна». Громкость - CoreAudio (`vmvc` устройства вывода), чтение раз в секунду. Rust (`src/media.rs`) → `island://media`, `island://volume`; команды `media_cmd` (белый список) и `set_volume`. Фронт `MediaDriver` → `s.media`, часы трека между обновлениями. Windows - системный медиа-сеанс SMTC (`src/media_win.rs`, `GlobalSystemMediaTransportControlsSessionManager`): опрос текущего сеанса 2 раза в секунду, сообщение - только при изменении (те же поля, что на Mac: шаффл и повтор в нумерации MediaRemote), обложка - миниатюра сеанса как есть (до 1 МБ), повторное чтение через 1.5, 3, 6 с; иконки плеера нет - запасная обложка сгенерированная. Команды - `TryTogglePlayPause`, `TrySkipNext/Previous`, `TryChangePlaybackPosition`, `TryChangeShuffleActive`, `TryChangeAutoRepeatMode`. Громкость - `IAudioEndpointVolume` устройства вывода по умолчанию, чтение раз в секунду. Обложка - реальная, своя сгенерированная остаётся запасной |
| GitHub | `src-tauri/src/github.rs`: fine-grained токен в Keychain (крейт `keyring`, сервис `dev.almanac.notch`), GraphQL `api.github.com` раз в минуту (`ureq`). Два запроса за опрос. Первый: до 30 репозиториев по `pushedAt` (не архивные), по каждому до 100 веток (голова: id, дата, автор), мои коммиты основной ветки за 7 дней, `review-requested:@me`. Из голов, где автор - я, берутся 10 самых свежих (одинаковые коммиты - один раз). Второй: `statusCheckRollup` этих коммитов (`nodes(ids)`). В карточке - CI с самым свежим запуском проверок (`completedAt`/`startedAt`/`createdAt`, иначе дата коммита) среди моих веток любого репозитория. Ветка `gh-pages` пропускается (деплой), с одного репозитория читается не больше 3 веток из 25, а остаются 10 строк с CI - по одной (самой свежей) на репозиторий. Коммит без привязанного пользователя считается моим. Больше 100 веток в репозитории - берутся первые 100 по алфавиту. Rust → `island://github` (`GhState`: репозитории с CI, число PR, времена коммитов), фронт `GithubDriver` (`feeds.ts`) → `s.github`, смену CI на ok или fail превращает в событие success или error. Команды `github_connect(token)` (проверка через viewer, затем Keychain), `github_disconnect`, `open_settings`. Токен фронту острова не отдаётся. Без токена запросов нет |
| Vercel | `src-tauri/src/vercel.rs`: токен в Keychain (сервис `dev.almanac.notch`, запись `vercel-token`), REST `api.vercel.com` раз в минуту (`ureq`, `native-tls`), только при `modules::is_on("vercel")` и с токеном. Опрос: `/v2/user`, `/v2/teams` (до 5 команд), `/v6/deployments?limit=20` для личного аккаунта и каждой команды; 10 самых свежих деплоев (одинаковые - один раз): проект, состояние `building/ready/error/canceled`, время, `production/preview`, ветка, `inspectorUrl` (только `https://vercel.com/…`). 401/403 - «токен не принят», пауза 5 мин; нет сети - растущая пауза, данные остаются. Rust → `island://vercel` (`VcState`), фронт `VercelDriver` (`feeds.ts`) → `s.vercel` (три строки карточки), смена деплоя на ready/error - событие success/error с `event.src = 'vercel'` (карточка Vercel). Команды `vercel_connect`, `vercel_disconnect`, `vercel_open(id)` - URL берётся из данных Rust, не со страницы |
| Notion | `src-tauri/src/notion.rs`: токен внутренней интеграции в Keychain (сервис `dev.almanac.notch`, запись `notion-token`), REST `api.notion.com` (`Notion-Version: 2022-06-28`) раз в минуту (`ureq`, `native-tls`), только при `modules::is_on("notion")` и с токеном. Опрос: `GET /v1/users/me` (название пространства), `POST /v1/search` (15 последних по правке, корзина отбрасывается, 10 остаются), `GET /v1/users` (участники; без права Read user information - пусто, ошибка не считается отказом). Страница: id, название (свойство типа title или заголовок базы), эмодзи, время правки, `last_edited_by`, ссылка (только `https://www.notion.so/…` и `https://notion.so/…`). «Я» - `<app data>/notion.json` (`notion_me`) или единственный человек пространства. 401/403 - «токен не принят», пауза 5 мин; нет сети и 429 - растущая пауза, данные остаются. Rust → `island://notion` (`NoState`), фронт `NotionDriver` (`feeds.ts`) → `s.notion` (три строки карточки), новая правка не мной - событие success с `event.src = 'notion'` (карточка Notion). Команды `notion_connect`, `notion_disconnect`, `notion_open(id)` (URL из данных Rust), `notion_me` |
| Grafana | `src-tauri/src/grafana.rs`: адрес и токен сервисного аккаунта в Keychain (сервис `dev.almanac.notch`, записи `grafana-url`, `grafana-token`), раз в минуту (`ureq`, `native-tls`), только при `modules::is_on("grafana")`, с адресом и токеном и только на этот адрес. Адрес: `https://`; `http://` - только локальная сеть (localhost, частные IP, `.local`, `.lan`). Токен проверяется через `/api/user` (Grafana с анонимным доступом отвечает на `/api/org` любому токену), название - `/api/org`. Опрос: `/api/prometheus/grafana/api/v1/rules` (404 = алерты выключены, правил нет), выбранный дашборд `/api/dashboards/uid/{uid}` и первый видимый запрос выбранной панели через `POST /api/ds/query` за `now-1h` (источник - объект с uid, имя или переменная дашборда типа datasource; встроенные источники Grafana не рисуются). Выбор дашборда и панели - `<app data>/grafana.json`. Команды `grafana_connect`, `grafana_disconnect`, `grafana_config`, `grafana_dashboards`, `grafana_panels`, `grafana_pick`, `grafana_open("alerts" | "board")` (URL собирается в Rust из сохранённого адреса); `feeds_state.grafana`, событие `island://grafana` |
| Окно настроек | обычное окно Tauri `settings` (`settings.html`, `src/settings.ts`), открывается строкой «Все настройки ›» во вкладке настроек острова (`s.settingsLink`, `s.requests` → `open_settings(section)`, `settings.html#раздел`) и пунктом трея. Клавиатура у него обычная, у панели острова её нет. Как в Raycast: вкладка «Общие» (состояние острова, чат вкл/выкл, проверка событий, выход) и «Модули» - список слева (иконка, статус, точка; выключенные приглушены), страница модуля справа: переключатель «Модуль включён», статус, настройки, «что читается и куда уходит». Модули: Claude Code (хуки), Календарь, Музыка, GitHub, Vercel и Notion (токен идёт прямо в Rust), Almanac (вход в аккаунт). Всё, что есть в трее, есть и здесь (решение 2026-10-15): команда `island_action(id)` = пункт трея (`tray::action`, белый список), `island_status` - состояние и установлены ли хуки |
| Модули вкл/выкл | `src-tauri/src/modules.rs`: `<app data>/modules.json` (`off` - id выключенных, `chat`). `modules_get`, `modules_set` (отказ, если выключены все или если кроме Claude Code включено больше 4 - как в coucou, `MAX_ON`; Vercel, Notion и Grafana по умолчанию выключены), событие `island://modules` → фронт пишет `s.off`, `s.chatOff`. Провайдеры проверяют `modules::is_on` на каждом круге: GitHub, Vercel, Notion, Grafana и Almanac - без запросов, календарь - без чтения, сервер хуков отвечает сразу, сообщения музыки не уходят в остров |
| Язык (этап 8) | Русский и английский. Ключ перевода - русская строка прототипа: `packages/island/src/i18n.ts` (`tr(s, 'текст', ...аргументы)`, таблица `EN`, `{0}` - аргументы). Поле `s.lang` (`'ru'` по умолчанию): в русском `tr` возвращает ключ, поэтому харнесс и parity не меняются. Живые данные (названия треков, встреч, репозиториев) проходят как есть. Тексты фронта (`feeds.ts`, `agent.ts`) - тем же `tr`, драйверы пересчитывают ленты при смене языка; глаголы шагов Claude остаются русскими ключами и переводятся в `stepAt`. Окно настроек: `src/settings-i18n.ts` - таблица `SETTINGS_EN` (ключ - текст `settings.html` со схлопнутыми пробелами), `translatePage` меняет текстовые узлы и `aria-label`/`placeholder`/`title` туда и обратно. Rust: `src-tauri/src/lang.rs`, `<app data>/lang.json` (`pick`: `auto`, `ru`, `en`; `auto` = первый язык системы: Mac - `NSLocale.preferredLanguages`, Windows - `GetUserDefaultUILanguage`, не русский → английский). `lang_get`, `lang_set`, событие `island://lang` → `s.lang` и окно настроек; трей перестраивается (`tray::relabel`), диалоги хуков и ошибки для окна настроек - через `lang::t(ru, en)`. Клиент `almanac-hook` (CLI) остаётся русским. Тесты: у каждой русской строки острова и окна настроек есть английская |
| Установщик | `tauri build`: Mac - `.app`, Windows - NSIS (`installMode: currentUser`, без прав администратора; WebView2 ставится загрузчиком, если его нет). Клиент хука - `externalBin`: `npm run hook:sidecar` (`apps/desktop/scripts/hook-sidecar.mjs`, запускается перед `tauri dev` и `tauri build`) собирает `almanac-hook` под целевую тройку в `src-tauri/binaries/`, бандл кладёт его рядом с исполняемым файлом, установщик хуков копирует оттуда. Подписи кода пока нет: SmartScreen и Gatekeeper предупредят |
| Almanac | `src-tauri/src/almanac.rs`: вход в Supabase Almanac как пользователь (`/auth/v1/token?grant_type=password`, код из письма - `/auth/v1/otp` + `/auth/v1/verify`), refresh token в Keychain (`almanac-refresh`, ротация - новый сохраняется при каждом обновлении, отказ = выход), access token только в памяти, почта - `<app data>/almanac.json`. Адрес проекта и публичный anon key - из сборки (`build.rs`: переменные `ALMANAC_URL`, `ALMANAC_KEY` или gitignored `src-tauri/.env.almanac`, шаблон `almanac-env.example`); без них модуль остаётся заглушкой прототипа. Данные - общее API интеграций Almanac (RPC, не под нотч): `today_habits(p_date)` раз в минуту и `toggle_habit(p_habit, p_date)` по нажатию, `p_date` - локальная дата. Только при `modules::is_on("almanac")` и со входом. Команды `almanac_sign_in`, `almanac_send_code`, `almanac_verify`, `almanac_sign_out`, `almanac_available`, `almanac_toggle(id)`; `feeds_state.almanac`, событие `island://almanac`. Фронт: `AlmanacDriver` (`src/feeds.ts`) - оптимистичная галочка, события, напоминание с 20:00 |

## Приватность (обязательные правила)

- Никакой телеметрии, аналитики и отчётов о падениях наружу.
- Сеть - только к сервисам, которые пользователь сам подключил. Шрифты и картинки - локально.
- Сервер хуков слушает только `127.0.0.1`, с токеном.
- Секреты только в системном хранилище.
- Всё, что модуль читает, видно в настройках модуля: «что читается и куда ходит».
- Календарь. Читает: названия и время событий на 48 ч вперёд (Mac - EventKit, только с разрешения; Windows - классический Outlook на этом компьютере или ссылка iCal). Пишет: выбор источника в `<app data>/calendar.json`, ссылку iCal - в Credential Manager (ссылка - секрет, хранится, только пока выбран iCal). Сеть: только ссылка iCal, которую вставил пользователь (HTTPS), раз в 5 минут. Outlook и EventKit - без сети.
- Музыка. Читает: что играет в системе (название, исполнитель, альбом, обложка, позиция), громкость. Пишет: на Mac `<app data>/libalmanac_media.dylib`, на Windows ничего. Команды плееру - только по кликам в острове. Сети нет: обложку отдаёт сам плеер.
- Claude Code. Читает: payload хуков (в окно попадает урезанным), хвосты `~/.claude/projects/*/*.jsonl` (только время и признак лимита), одно поле `~/.claude.json`. Пишет: `~/.claude/settings.json` (только после подтверждения, с бэкапом), `<app data>/hook.json`, `<app data>/almanac-hook`. Сети нет.
- GitHub. Читает: имена репозиториев, статус проверок голов моих веток (10 самых свежих), число PR на моё ревью, время моих коммитов за 7 дней. Пишет: токен в Keychain. Сеть: только `api.github.com` (HTTPS), раз в минуту, и только с подключённым токеном.
- Vercel. Читает: имя пользователя, список команд, последние деплои (проект, состояние, продакшен или превью, ветка, время, ссылка на страницу деплоя). Код, переменные окружения и логи не читаются. Пишет: токен в Keychain. Сеть: только `api.vercel.com` (HTTPS), раз в минуту, только с токеном и при включённом модуле. Кнопка ↗ открывает `https://vercel.com/…` в браузере пользователя.
- Notion. Читает: название рабочего пространства, имена участников (без почты), у страниц, к которым пользователь дал доступ интеграции: название, эмодзи, кто и когда правил последним, ссылку. Содержимое страниц не читается. Пишет: токен в Keychain, выбор «это я» в `<app data>/notion.json`. Сеть: только `api.notion.com` (HTTPS), раз в минуту, только с токеном и при включённом модуле. Строка карточки открывает `https://www.notion.so/…` в браузере.
- Almanac. Читает: привычки на сегодня (название, сколько отмечено, сколько нужно за день) через `today_habits`. Пишет: отметку привычки через `toggle_habit` (как нажатие в Almanac), refresh token в Keychain, почту в `<app data>/almanac.json`. Пароль не сохраняется. Заметки, серии, тренировки и другие данные не читаются. Сеть: только сервер Almanac из сборки, раз в минуту и по нажатию, только со входом и при включённом модуле.
- Grafana. Читает: название организации, правила алертов (название, состояние, время начала), список дашбордов (для выбора в настройках), у выбранного дашборда - название и числа одной панели за последний час. Логи, другие данные и настройки Grafana не читаются. Пишет: адрес и токен в Keychain, выбор дашборда и панели в `<app data>/grafana.json`. Сеть: только адрес, который ввёл пользователь (HTTPS; HTTP - только локальная сеть), раз в минуту, только с токеном и при включённом модуле. Карточка открывает список алертов или дашборд на этом адресе в браузере.
- Обновления (этап 8f, решение владельца 2026-10-18). При запуске (через 20 с) и раз в сутки, если в «Общих» включено «Проверять обновления» (по умолчанию включено), приложение читает `https://github.com/Sorakiel/almanac-notch/releases/latest/download/latest.json` - номер версии и подписи файлов. Ничего о пользователе не отправляется. Файл обновления скачивается только по кнопке «Обновить» (окно настроек или трей), проверяется подписью minisign (открытый ключ в `tauri.conf.json`, закрытый - только в секретах GitHub) и ставится с перезапуском. Это единственный запрос не к подключённому пользователем сервису. Код - `src-tauri/src/update.rs`.
- Запуск при входе - `tauri-plugin-autostart`: на Mac LaunchAgent в `~/Library/LaunchAgents`, на Windows ключ `Run` в реестре пользователя. Включается галочкой в мастере первого запуска или в «Общих».
- Первый запуск: флаг `onboarded` в `<app data>/app.json` (`src-tauri/src/prefs.rs`). Без флага при старте открывается окно настроек на мастере (`settings.html#welcome`).

## Запасной путь

Если на этапе 1 окажется, что Tauri не даёт нужного окна на Mac (уровень над меню-баром, клики насквозь, все рабочие столы), оболочку на Mac делаем нативной: Swift, `NSPanel` и `WKWebView`, в котором тот же бандл `packages/island`. Windows остаётся на Tauri. Рендер при этом не меняется - ради этого он и сделан независимым от оболочки.
