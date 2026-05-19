# PRD — LUMARPA Desktop UI

> Дата последнего обновления: 2026-01-19
> Репозиторий: https://github.com/Ado-gado/LUMARPA

## Исходная задача

Построить минималистичный desktop UI (тёмная тема, на русском) для существующего Node.js проекта автоматизации регистрации аккаунтов. Существующий backend не модифицировать — только добавить:
- `src/api.js` — Express REST API
- React-фронтенд
- Electron-обёртку с Windows NSIS installer

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  Electron main (electron/main.js)                           │
│  ├── require('src/api.js')         → стартует Express:3001  │
│  └── BrowserWindow → loads http://127.0.0.1:3001/           │
│                                                              │
│  Express (src/api.js)                                       │
│  ├── REST endpoints /api/*         → better-sqlite3 (DB)    │
│  ├── SSE /api/logs/stream          → tail logs/<date>.log   │
│  ├── POST /api/start               → spawn node src/index.js│
│  └── static /                      → src/ui/dist (React)    │
│                                                              │
│  React UI (src/ui/, build → src/ui/dist/)                   │
│  ├── Vite + Tailwind + React 18                             │
│  └── 5 вкладок: Дашборд / Логи / Аккаунты / Прокси /        │
│                  Настройки                                   │
└─────────────────────────────────────────────────────────────┘
```

## Tech stack

- Express 4 + cors + better-sqlite3 (API)
- React 18 + Vite 5 + Tailwind 3 (UI)
- Electron 33 + electron-builder 25 (NSIS installer)

## Создано / реализовано

### Новые файлы (без модификации существующих)
- `src/api.js` — 20+ REST endpoints + SSE + spawn-управление воркером
- `src/ui/` — Vite + React + Tailwind проект
  - `src/ui/src/App.jsx` — header со статусом + табы
  - `src/ui/src/tabs/Dashboard.jsx` — 4 stat-карточки, Start/Stop, recent activity
  - `src/ui/src/tabs/Logs.jsx` — real-time SSE, фильтры info/warn/error, цветовая разметка
  - `src/ui/src/tabs/Accounts.jsx` — таблица + импорт + пагинация + экспорт registered.txt
  - `src/ui/src/tabs/Proxies.jsx` — Browser AdsPower и IMAP пулы рядом
  - `src/ui/src/tabs/Settings.jsx` — все ключи .env с валидацией типов
- `electron/main.js` — окно + tray + single-instance + userData пути
- `electron/preload.js` — contextIsolation стартовый bridge
- `assets/` — место для icon.ico (положить вручную)

### Обновлено
- `package.json` — добавлены deps (express, cors, electron, electron-builder, concurrently, wait-on) и build-блок для NSIS

### Существующие файлы НЕ ТРОНУТЫ
✅ `src/worker.js`, `src/index.js`, `src/config.js`, `src/logger.js`,
   `src/database/*`, `src/services/*`, `scripts/db.js`

## Результаты тестирования (iteration 1)

| Зона        | Результат                                        |
|-------------|--------------------------------------------------|
| Backend API | 22/22 pytest-тестов (health, stats, emails, proxies, imap, logs, start/stop, settings, SSE) |
| Frontend    | 5/5 вкладок рендерятся, навигация работает, нет ошибок в консоли |
| Локализация | Весь UI на русском                                |
| Тёмная тема | #0f0f0f / #1a1a1a / #2a2a2a согласно UI_SPEC      |

## Команды для пользователя

```bash
# Установить зависимости (один раз)
yarn install
cd src/ui && yarn install && cd ../..

# Собрать React UI
yarn ui:build

# Запустить локально (без Electron) — http://127.0.0.1:3001
yarn api

# Dev: API + Electron одновременно
yarn electron:dev

# Собрать Windows installer (.exe в release/) — ВЫПОЛНЯТЬ НА WINDOWS
yarn dist
```

## Backlog / возможные улучшения

- P2: разбить `src/api.js` на routes/* (сейчас ~600 строк)
- P2: tee stdout/stderr воркера в `logs/<date>.log` чтобы при ранней ошибке инициализации она попадала в /api/logs (сейчас попадает только в /api/status.lastError)
- P2: добавить иконку `assets/icon.ico` (пока electron-builder подставит дефолтную)
- P3: tooltip/удаление поля "Аккаунтов к регистрации" — существующий `src/index.js` сейчас не читает `REGISTER_COUNT` (поле сохранено на будущее)
- P3: разделение sessions и проверка единственного экземпляра уже сделана (`requestSingleInstanceLock`)

## Что должен сделать пользователь до запуска

1. Заполнить `.env` (через вкладку **Настройки** в UI): `TARGET_URL`, `CAPSOLVER_API_KEY`, `ADSPOWER_GROUP_ID`
2. Импортировать GMX-аккаунты и прокси через вкладки **Аккаунты** и **Прокси**
3. Заменить заглушки селекторов в существующем `src/worker.js` (STEP 8, 10, 12) — это не входит в задание UI
4. На Windows: `yarn install && yarn dist` → `release/LumaBot-Setup-1.0.0.exe`
