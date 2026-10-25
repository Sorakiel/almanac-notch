# Раскадровка coucou

Живой coucou (веб-версия для Windows и Linux, тот же код анимаций) на виртуальных часах - чтобы сравнивать сцену кадр в кадр с нашей (`tools/strip.mjs`).

1. `git clone https://github.com/Louis-CFM/coucou.git` (полная история, не `--depth 1`) в scratchpad.
2. Скопировать `tabs-preview.html` и `tabs-preview.ts` в `coucou/windows/dev/`.
3. `cd coucou/windows && npm install --ignore-scripts && npx vite --port 5288 --strictPort`.
4. Из корня нашего репо: `OUT=.parity/strip node tools/coucou/strip.mjs prompt 48` - смена вида overview → prompt (чат), кадры в `.parity/strip/cc-prompt/`.

На странице доступны `window.island` (`expand`, `setView`, `collapse`) и `window.State`.
