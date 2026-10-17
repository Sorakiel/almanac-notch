# Almanac Notch

Остров у выреза камеры MacBook (и у верхнего края экрана на Windows) с живым маскотом. Показывает, что делают агенты Claude Code, и даёт отвечать им прямо из нотча. Рядом календарь, музыка, GitHub и другие модули. Работает локально, без телеметрии. Almanac - один из модулей, но не обязательный.

## Что здесь сейчас

- `prototype/island-prototype.html` - утверждённый интерактивный прототип. Открой в браузере: это эталон вида и поведения.
- `reference/` - кадры и ролики всех состояний, снятые с прототипа.
- `docs/` - спецификация, архитектура, план, сверка с прототипом.
- `tools/` - съёмка эталона и сравнение реализации с ним.

- `packages/island` - рендер острова и маскота, `apps/harness` - стенд сверки, `apps/desktop` - приложение (Tauri 2 + Rust).

## Запуск и сборка

### Windows: проверить с нуля

1. Поставить один раз:
   - [Git](https://git-scm.com/download/win), [Node.js 22+](https://nodejs.org) (LTS);
   - [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) - в установщике отметить «Разработка классических приложений на C++»;
   - [Rust](https://rustup.rs) - `rustup-init.exe`, всё по умолчанию.
   WebView2 в Windows 10/11 уже есть.
2. В новом окне PowerShell:

   ```
   git clone -b stage-7-windows https://github.com/Sorakiel/almanac-notch.git
   cd almanac-notch
   npm install
   npm run installer
   ```

   Первая сборка идёт 10-20 минут. В конце: `[installer] ready: ...\release\Almanac Notch Setup.exe`.
3. Запустить `release\Almanac Notch Setup.exe`. Прав администратора не нужно. Подписи пока нет: SmartScreen спросит - «Подробнее» → «Выполнить в любом случае».

Без установщика, в режиме разработки (с логом в консоли): `npm run desktop:dev`.

### Mac

Нужны Node 22+, Rust и Xcode Command Line Tools (`xcode-select --install`). `npm install`, потом `npm run desktop:dev` или `npm run installer` - готовое приложение появится в `release/Almanac Notch.app`.

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
