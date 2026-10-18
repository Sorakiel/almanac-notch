# Эталон

Снято с `prototype/island-prototype.html` скриптом `tools/snapshot.mjs`. Сцены описаны в `tools/scenes.mjs`.

- **Кадры** снимаются при виртуальном времени (`page.clock`, старт 14.10.2026 10:30) и с фиксированным сидом случайности. Один и тот же прогон всегда даёт один и тот же кадр. Плотность 2× (пиксели ретины), канвас острова 560×200 pt, лупа 252×120 pt.
- **Окружение кадров:** macOS 27.0, MacBook Air (M4, Mac16,13), Playwright 1.64.0 (Chromium headless shell 1248). Пересняты 14.10.2026: сменилось окружение (раньше - облачный Linux, Playwright 1.56). Визуальных изменений нет: отличается только сглаживание текста и фаза движения примерно на один кадр (например, в `greeting-0900` маскот появляется ровно на 0.9 с).
- **Ролики** записаны в реальном времени. Это область превью нотча на странице прототипа: запись в 1×, увеличенная вдвое для просмотра, mp4 (H.264). Для деталей в пикселях смотри кадры, для таймингов - ролики.

## screens/

| группа | кадры |
|---|---|
| закрыто | `mac-closed`, `win-closed-tile` |
| полуоткрыто | `half-after-launch`, `half-working`, `half-thinking`, `half-searching`, `half-ratelimit`, `half-success`, `half-error`, `half-dance`, `half-attention`, `half-question`, `half-sleep`, `win-half-working`. К большинству есть `-loupe` - лупа ×3 по маскоту |
| открыто, «Главная» | `open-focus-claude`, `open-focus-github`, `open-focus-cal`, `open-focus-music`, `open-focus-almanac`, `open-music-rail-hover` (выехавшая подпись в колонке) |
| открыто, события | `open-working-steps`, `open-github-error`, `open-attention`, `open-attention-approved`, `open-question`, `open-ratelimit` |
| перегруз | `overload-0.3s`, `overload-1.2s`, `overload-1.2s-stage`, `overload-after` |
| вкладки | `open-tab-chat`, `open-tab-add`, `open-tab-settings` |
| ввод в открытом острове | `input-tab-chat`, `input-settings-pref`, `input-mute`, `input-focus-chip`, `input-rail-click`, `input-player-pause`, `input-player-next`, `input-player-controls` (перемотка, громкость, shuffle, repeat), `input-habit`, `input-habits-all-done` (пятая привычка отмечена напрямую - в прототипе кликабельны только три), `input-approve-hover`, `input-approve-click`, `input-deny-key`, `input-question-key`, `input-question-click`, `input-card-dblclick`. Клики - в центр зоны из списка `hits` страницы. Добавлены 14.10.2026 с разрешения владельца, остальные кадры не переснимались |
| приветствие | `greeting-0300` … `greeting-4300`: время от начала события в мс |
| большая сцена | `stage-idle`, `stage-working`, `stage-thinking`, `stage-searching`, `stage-ratelimit`, `stage-dance`, `stage-success`, `stage-sleep`, `stage-grumpy` |
| страница целиком | `page` |

## video/

| ролик | что смотреть |
|---|---|
| `greeting` | все такты запуска |
| `overload` | вход, раскачка, морф глаз, кроссфейд, выход |
| `success-error` | вспышки обводки, кольца, тряска содержимого |
| `attention-answer` | печать команды, «Разрешено», переход в работу |
| `question-answer` | появление вариантов, выбор |
| `states-auto` | переходы закрыто, полуоткрыто, открыто по наведению |
| `music-dance` | танец под музыку, выезд подписи в колонке |
| `focus-switch` | въезд карточек при смене модуля |
| `win-states` | Windows: плитка, полоса, открытие |
| `ratelimit` | песочные часы, переворот |
