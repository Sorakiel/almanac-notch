# Almanac Notch

Остров у выреза камеры MacBook (и у верхнего края экрана на Windows) с живым маскотом. Показывает, что делают агенты Claude Code, и даёт отвечать им прямо из нотча. Рядом календарь, музыка, GitHub и другие модули. Работает локально, без телеметрии. Almanac - один из модулей, но не обязательный.

## Что здесь сейчас

- `prototype/island-prototype.html` - утверждённый интерактивный прототип. Открой в браузере: это эталон вида и поведения.
- `reference/` - кадры и ролики всех состояний, снятые с прототипа.
- `docs/` - спецификация, архитектура, план, сверка с прототипом.
- `tools/` - съёмка эталона и сравнение реализации с ним.

- `packages/island` - рендер острова и маскота, `apps/harness` - стенд сверки, `apps/desktop` - приложение (Tauri 2 + Rust).

## Установка

Готовые установщики - на странице [Releases](https://github.com/Sorakiel/almanac-notch/releases/latest).

- **Mac** (Apple silicon и Intel, macOS 12+): `Almanac_Notch_<версия>_universal.dmg` - открыть, перетащить Almanac Notch в «Программы», запустить. Подписи Apple пока нет: при первом запуске macOS скажет, что не может проверить разработчика. Откройте «Системные настройки → Конфиденциальность и безопасность», внизу - «Всё равно открыть». Это нужно один раз.
- **Windows** 10/11: `Almanac_Notch_<версия>_x64-setup.exe`. Прав администратора не нужно. Подписи пока нет: SmartScreen спросит - «Подробнее» → «Выполнить в любом случае».

При первом запуске откроется мастер: язык, подключение Claude Code (хуки ставятся одной кнопкой, перед записью виден дифф), календарь, модули, запуск вместе с системой. Любой шаг можно пропустить, мастер снова открывается из меню трея. Дальше приложение раз в день проверяет новую версию и ставит её по кнопке «Обновить» (выключается в настройках, «Общие»).

## Запуск и сборка

### Windows: проверить с нуля

1. Поставить один раз:
   - [Git](https://git-scm.com/download/win), [Node.js 22+](https://nodejs.org) (LTS);
   - [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) - в установщике отметить «Разработка классических приложений на C++»;
   - [Rust](https://rustup.rs) - `rustup-init.exe`, всё по умолчанию.
   WebView2 в Windows 10/11 уже есть.
2. В новом окне PowerShell:

   ```
   git clone -b stage-8-release https://github.com/Sorakiel/almanac-notch.git
   cd almanac-notch
   npm install
   npm run installer
   ```

   Первая сборка идёт 10-20 минут. В конце: `[installer] ready: ...\release\Almanac Notch Setup.exe`.
3. Запустить `release\Almanac Notch Setup.exe`. Прав администратора не нужно. Подписи пока нет: SmartScreen спросит - «Подробнее» → «Выполнить в любом случае».

Без установщика, в режиме разработки (с логом в консоли): `npm run desktop:dev`.

### Mac

Нужны Node 22+, Rust и Xcode Command Line Tools (`xcode-select --install`). `npm install`, потом `npm run desktop:dev` или `npm run installer` - в `release/` появятся `Almanac Notch.dmg` и `Almanac Notch.app`.

Модуль Almanac: чтобы приложение могло войти в Almanac, перед сборкой скопируйте `apps/desktop/src-tauri/almanac-env.example` в `apps/desktop/src-tauri/.env.almanac` и впишите адрес проекта и публичный ключ Almanac (или задайте переменные `ALMANAC_URL`, `ALMANAC_KEY`). Без файла сборка работает, а модуль показывает пример привычек.

### Релиз

Установщики собирает GitHub Actions (`.github/workflows/release.yml`) по тегу `v*`: Mac - один universal .dmg, Windows - Setup.exe, плюс файлы обновления (`latest.json` и подписанные архивы). Релиз создаётся черновиком.

Один раз - секреты репозитория (Settings → Secrets and variables → Actions):
- `TAURI_SIGNING_PRIVATE_KEY` - содержимое `~/.tauri/almanac-notch.key` (закрытый ключ подписи обновлений; открытый уже в `tauri.conf.json`). Ключ не терять и не публиковать: без него установленные приложения не примут обновление.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - пароль ключа (у текущего - пустой, секрет можно не создавать).
- `ALMANAC_URL`, `ALMANAC_KEY` - адрес и публичный ключ Almanac (без них модуль показывает пример привычек).
- `MAC_CERT_P12` - `base64 -i ~/.tauri/almanac-notch-sign.p12`, `MAC_CERT_PASSWORD` - содержимое `~/.tauri/almanac-notch-sign.pass`. Это самоподписанный сертификат «Almanac Notch»: все сборки Mac подписаны одинаково, и macOS не спрашивает заново пароль связки ключей и доступ к календарю после каждого обновления. Без него сборка подписана ad-hoc. Сертификат не терять.

Каждый релиз:
1. `npm run release:version 0.1.1` - версия во всех файлах, закоммитить.
2. `git tag v0.1.1 && git push origin v0.1.1` - через 15-25 минут в Releases появится черновик.
3. Проверить файлы черновика и нажать «Publish release». Только после публикации установленные приложения увидят новую версию. Тег с дефисом (`v0.2.0-rc.1`) создаёт пре-релиз - его автообновление не предлагает.

Локальная сборка на Mac подписывается тем же сертификатом, если один раз добавить его в связку «Вход» как доверенный для подписи кода (спросит пароль):

```bash
security import ~/.tauri/almanac-notch-sign.p12 -k ~/Library/Keychains/login.keychain-db -P "$(cat ~/.tauri/almanac-notch-sign.pass)" -T /usr/bin/codesign
security add-trusted-cert -r trustRoot -p codeSign -k ~/Library/Keychains/login.keychain-db ~/.tauri/almanac-notch-sign.pem
```

Без этого `npm run installer` подписывает ad-hoc и пишет об этом.

Иконки (маскот) пересобираются `node apps/desktop/scripts/icon.mjs`.

`release/` и `apps/desktop/src-tauri/target/` - результаты сборки, их нет в git: они появляются после сборки.

## Прототип

Открой `prototype/island-prototype.html` в Chrome или Safari.

**Клавиши событий:**

| клавиша | событие | клавиша | событие |
|---|---|---|---|
| 1 | Внимание | 7 | Успех |
| 2 | Работает | 8 | Ошибка |
| 3 | Думает | 9 | Праздник |
| 4 | Ищет | 0 | Привет |
| 5 | Вопрос | Q | Сон |
| 6 | Лимит | | |

Во время подтверждения работают Y и N, во время вопроса - 1, 2, 3.

**С маскотом на сцене можно:** водить курсором, кликать, кликнуть 3 и 6 раз подряд, дважды кликнуть, гладить по макушке, перетаскивать.

Сверху переключаются экран (Mac или Windows) и состояние острова.

## Скрипты сверки

```bash
npm install
npx playwright install chromium
npm run ref:screens     # заново снять кадры эталона из прототипа
npm run ref:clips       # ролики (нужен ffmpeg)
npm run parity          # собрать харнесс, снять те же сцены и сравнить (сервер поднимается сам)
```
