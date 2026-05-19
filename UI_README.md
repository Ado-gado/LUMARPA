# UI / Electron — инструкция по запуску

Этот файл описывает только новый UI-слой. Существующий бэкенд работает как и раньше — `node src/index.js`.

## Установка

```bash
# Из корня репозитория
yarn install
cd src/ui && yarn install && cd ../..
```

## Сборка UI

```bash
yarn ui:build
# → собранный фронт лежит в src/ui/dist/
```

## Запуск

### Только API + UI в браузере
```bash
yarn api
# → http://127.0.0.1:3001/
```

### Dev-режим (hot-reload UI + Electron)
```bash
yarn electron:dev
```

### Production-режим (Electron подгружает собранный UI)
```bash
yarn ui:build
yarn electron
```

## Сборка Windows-установщика (.exe)

⚠️ Выполнять **на Windows-машине** (electron-builder с NSIS требует Windows). На Linux/Mac кросс-сборка возможна, но требует wine/mono.

```bash
# Положи иконку 256x256 в assets/icon.ico (опционально)
yarn dist
# → release/LumaBot-Setup-1.0.0.exe
```

**NSIS-конфигурация** (в `package.json` → `build.nsis`):
- `oneClick: false` — мастер с шагами установки
- `allowToChangeInstallationDirectory: true` — пользователь выбирает папку
- `createDesktopShortcut: true` — ярлык на рабочий стол
- `createStartMenuShortcut: true` — пункт в меню Пуск
- `deleteAppDataOnUninstall: false` — БД и логи сохраняются при удалении

В установленном виде:
- БД пишется в `%APPDATA%/Luma Registration Bot/data/accounts.db`
- Логи: `%APPDATA%/Luma Registration Bot/logs/`
- `.env`: `%APPDATA%/Luma Registration Bot/.env` (создаётся из `.env.example` при первом запуске)

## Структура добавленных файлов

```
src/api.js                       — Express REST API + SSE
src/ui/                          — React + Vite + Tailwind проект
  ├── index.html
  ├── vite.config.js
  ├── tailwind.config.js
  ├── postcss.config.js
  ├── package.json
  └── src/
      ├── main.jsx
      ├── index.css
      ├── api.js                 — клиент REST
      ├── App.jsx                — header + табы
      └── tabs/
          ├── Dashboard.jsx
          ├── Logs.jsx
          ├── Accounts.jsx
          ├── Proxies.jsx
          └── Settings.jsx
electron/
  ├── main.js                    — окно + tray + single-instance + auto-start API
  └── preload.js
assets/                          — место для icon.ico
```

## Конфигурация .env

Все настройки задаются через вкладку **Настройки** в UI или редактированием `.env` в корне (или в `userData` при упаковке).

Обязательные перед стартом воркера:
- `TARGET_URL` — URL страницы регистрации
- `CAPSOLVER_API_KEY` — ключ Capsolver
- `ADSPOWER_GROUP_ID` — ID группы AdsPower

Без них `POST /api/start` запустит воркер, и он сразу упадёт с exit code 1 (это поведение существующего `src/config.js`), статус в UI станет «Ошибка».
