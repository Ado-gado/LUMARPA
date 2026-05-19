# Implementation Plan: Account Registration Automation

## Overview

Реализация серверного Node.js-приложения для автоматизации регистрации аккаунтов. Задачи упорядочены так, чтобы каждый шаг давал рабочий и тестируемый код. Стек: Node.js, Playwright, AdsPower Local API, SQLite (better-sqlite3), Capsolver, firstmail.ltd IMAP API.

## Tasks

- [x] 1. Инициализация проекта и конфигурация
  - [x] 1.1 Создать структуру проекта и `package.json`
    - Инициализировать `npm init` с полями `name`, `version`, `type: "module"` (или CommonJS — выбрать CJS для совместимости с `better-sqlite3`)
    - Установить зависимости: `playwright`, `better-sqlite3`, `dotenv`, `winston`, `winston-daily-rotate-file`
    - Создать директории: `src/database/`, `src/services/`, `config/`, `logs/`, `screenshots/`, `cookies/`
    - _Требования: 10.1, 10.2_

  - [x] 1.2 Создать `config/.env.example` с шаблоном конфигурации
    - Добавить все обязательные параметры: `TARGET_URL`, `MAX_RETRIES`, `EMAIL_TIMEOUT_MS`, `PLAYWRIGHT_TIMEOUT_MS`, `CAPSOLVER_API_KEY`, `FIRSTMAIL_TOKEN`, `ADSPOWER_API_URL`, `ADSPOWER_GROUP_ID`, `PROXY_PROTOCOL`, `CONCURRENCY`, `DB_TYPE`, `DB_PATH`, `LOG_LEVEL`
    - _Требования: 10.2, 10.3_

  - [x] 1.3 Создать модуль загрузки и валидации конфигурации `src/config.js`
    - Загружать `.env` через `dotenv`
    - Проверять наличие всех обязательных параметров при старте
    - Завершать процесс с понятным сообщением об ошибке, если параметр отсутствует
    - Экспортировать объект конфигурации с типизированными значениями (числа, строки)
    - _Требования: 10.1, 10.2, 10.3_

- [x] 2. Модуль логирования `src/logger.js`
  - [x] 2.1 Реализовать `src/logger.js` на базе `winston`
    - Настроить два транспорта: `Console` (stdout, human-readable формат) и `DailyRotateFile` (директория `logs/`, ротация по дате)
    - Поддержать уровни: `error`, `warn`, `info`, `debug`
    - Фильтровать сообщения ниже уровня `LOG_LEVEL` из конфигурации
    - Включать в каждое сообщение: временную метку, уровень, текст
    - Логировать полный `stack trace` при уровне `error`
    - Автоматически создавать директорию `logs/` если не существует
    - _Требования: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 3. Модуль базы данных `src/database/`
  - [x] 3.1 Создать интерфейс и SQLite-реализацию `src/database/index.js` и `src/database/sqlite.js`
    - Подключиться к SQLite через `better-sqlite3` с включённым WAL-режимом (`PRAGMA journal_mode=WAL`)
    - Реализовать метод `migrate()` — создание всех таблиц при запуске если не существуют
    - Создать таблицы: `emails`, `proxies`, `adspower_profiles`, `registrations`, `error_logs` согласно схеме из Требования 12
    - Добавить индексы на `emails.status`, `proxies.status` для ускорения выборки
    - Экспортировать фабричную функцию `createDatabase(config)` возвращающую объект с методами
    - _Требования: 11.4, 12.1–12.7_

  - [x] 3.2 Реализовать атомарные методы выборки email и прокси
    - `claimEmail()` — атомарный SELECT + UPDATE в транзакции: выбрать `available` email с `attempts < max_retries`, установить статус `in_progress`, вернуть запись или `null`
    - `claimProxy()` — атомарный SELECT + UPDATE в транзакции: выбрать `available` прокси, установить статус `in_use`, вернуть запись или `null`
    - `releaseEmail(id, status)` — обновить статус email (`available`, `registered`, `failed`)
    - `releaseProxy(id, status)` — обновить статус прокси (`available`, `used`, `failed`)
    - `incrementEmailAttempts(id)` — увеличить `attempts` на 1
    - Использовать `better-sqlite3` синхронные транзакции (`db.transaction(fn)()`)
    - _Требования: 1.1, 1.2, 2.1, 2.2, 11.2, 11.3, 12.7_

  - [x] 3.3 Реализовать методы записи результатов и ошибок
    - `saveAdsPowerProfile(data)` — INSERT в `adspower_profiles`
    - `saveRegistration(data)` — INSERT в `registrations` со статусом `success`
    - `saveErrorLog(data)` — INSERT в `error_logs` с полями: `email_id`, `proxy_id`, `step`, `error_message`, `error_stack`, `screenshot_path`
    - _Требования: 3.4, 7.4, 8.3, 12.3, 12.4, 12.5_

- [x] 4. Checkpoint — база данных и конфигурация работают
  - Убедиться, что `src/config.js` корректно валидирует `.env`
  - Убедиться, что `createDatabase()` создаёт все таблицы без ошибок
  - Убедиться, что `claimEmail()` и `claimProxy()` корректно работают при параллельных вызовах
  - Задать вопросы пользователю при необходимости

- [x] 5. Сервис AdsPower `src/services/adspower.js`
  - [x] 5.1 Реализовать `src/services/adspower.js`
    - Реализовать `createProfile(proxyData, groupId)` — POST к AdsPower Local API для создания профиля с прокси, вернуть `profile_id`
    - Реализовать `startProfile(profileId)` — GET к AdsPower Local API для запуска профиля, вернуть `cdpEndpoint` (поле `ws.puppeteer` из ответа)
    - Реализовать `stopProfile(profileId)` — GET к AdsPower Local API для остановки профиля
    - Реализовать `deleteProfile(profileId)` — DELETE профиля (опционально, для очистки)
    - Использовать нативный `fetch` (Node.js 18+) или `https` модуль для HTTP-запросов
    - Логировать все запросы и ответы через `logger`
    - При ошибке API бросать кастомный `AdsPowerError` с кодом и сообщением
    - _Требования: 3.1, 3.2, 3.3, 3.5, 7.6, 8.9_

- [x] 6. Сервис email `src/services/email.js`
  - [x] 6.1 Реализовать `src/services/email.js` для firstmail.ltd IMAP API
    - Реализовать `waitForConfirmationCode(emailAddress, timeoutMs)` — polling GET-запросов к firstmail.ltd API с токеном в заголовке `Authorization: Bearer <token>`
    - Опрашивать API каждые 5 секунд до получения письма или истечения `timeoutMs`
    - Извлекать `ConfirmationCode` из тела письма регулярным выражением (настраиваемый паттерн в конфиге)
    - При таймауте бросать `EmailTimeoutError`
    - При невозможности извлечь код бросать `EmailParseError`
    - Логировать каждую попытку опроса
    - _Требования: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7_

- [x] 7. Сервис капчи `src/services/captcha.js`
  - [x] 7.1 Реализовать `src/services/captcha.js` для Capsolver
    - Реализовать `solveRecaptchaV2(siteKey, pageUrl)` — создать задачу в Capsolver API, polling результата
    - Реализовать `solveRecaptchaV3(siteKey, pageUrl, action)` — аналогично для v3
    - Polling каждые 3 секунды, максимум 120 секунд
    - При ошибке или таймауте бросать `CaptchaError`
    - Логировать создание задачи и получение результата
    - _Требования: 5.1, 5.2, 5.4_

- [x] 8. Сервис экспорта cookies `src/services/cookies.js`
  - [x] 8.1 Реализовать `src/services/cookies.js`
    - Реализовать `exportCookies(page, emailAddress)` — получить cookies через `page.context().cookies()`, сохранить в JSON-файл в директорию `cookies/` с именем `<email>.json`
    - Автоматически создавать директорию `cookies/` если не существует
    - Логировать путь сохранённого файла
    - _Требования: 7.3_

- [x] 9. Оркестратор регистрации `src/worker.js`
  - [x] 9.1 Реализовать основной цикл регистрации в `src/worker.js`
    - Реализовать `runWorker(db, config, logger)` — асинхронная функция одного цикла регистрации
    - Шаг 1: `db.claimEmail()` — если `null`, логировать и завершить
    - Шаг 2: `db.claimProxy()` — если `null`, вернуть email в `available`, логировать и завершить
    - Шаг 3: `adsPower.createProfile()` + `db.saveAdsPowerProfile()` + `adsPower.startProfile()` → получить `cdpEndpoint`
    - Шаг 4: `playwright.connect({ wsEndpoint: cdpEndpoint })` → подключиться к браузеру
    - Шаг 5: включить блокировку ресурсов через `page.route()` для `image`, `media`, `font`, `stylesheet`
    - Шаг 6: открыть `TARGET_URL`, заполнить форму регистрации
    - Шаг 7: если обнаружена капча — вызвать `captcha.solve()`, вставить токен
    - Шаг 8: отправить форму
    - Шаг 9: `email.waitForConfirmationCode()` → ввести код подтверждения, отправить
    - Шаг 10 (успех): `db.releaseEmail(id, 'registered')`, `db.releaseProxy(id, 'used')`, `cookies.exportCookies()`, `db.saveRegistration()`, логировать успех
    - Шаг 11: `adsPower.stopProfile()` в блоке `finally`
    - _Требования: 1.1–1.3, 2.1–2.3, 3.1–3.5, 4.1–4.7, 5.1–5.4, 6.1–6.7, 7.1–7.6_

  - [x] 9.2 Реализовать процедуру обработки ошибок в `src/worker.js`
    - Обернуть весь цикл в `try/catch`
    - В `catch`: сделать скриншот `page.screenshot()` → сохранить в `screenshots/<email>_<timestamp>.png`
    - Вызвать `db.saveErrorLog()` с шагом, текстом и стеком ошибки, путём скриншота
    - Логировать ошибку через `logger.error()`
    - Если `attempts < max_retries`: `db.incrementEmailAttempts()` + `db.releaseEmail(id, 'available')`
    - Если `attempts >= max_retries`: `db.releaseEmail(id, 'failed')`
    - Если ошибка связана с прокси: `db.releaseProxy(id, 'failed')`, иначе `db.releaseProxy(id, 'available')`
    - Вызвать `adsPower.stopProfile()` в `finally`
    - _Требования: 8.1–8.9_

- [x] 10. Точка входа `src/index.js`
  - [x] 10.1 Реализовать `src/index.js` — конкурентный запуск воркеров
    - Загрузить конфигурацию через `src/config.js`
    - Инициализировать `logger`, `db` (с миграцией), все сервисы
    - Запустить `CONCURRENCY` параллельных воркеров через `Promise.all` или пул с очередью
    - Каждый воркер работает в цикле пока есть доступные email
    - Реализовать graceful shutdown: перехватить `SIGINT`/`SIGTERM`, установить флаг остановки, дождаться завершения текущего шага всех воркеров
    - Логировать старт, количество воркеров, завершение
    - Автоматически создавать директории `logs/`, `screenshots/`, `cookies/` при старте
    - _Требования: 10.1, 11.1, 11.2, 11.5_

- [x] 11. Checkpoint — финальная проверка
  - Убедиться, что все модули корректно импортируются без ошибок
  - Убедиться, что `node src/index.js` запускается и корректно завершается при отсутствии email в БД
  - Убедиться, что SIGINT корректно завершает процесс
  - Задать вопросы пользователю при необходимости

## Notes

- Задачи, отмеченные `*`, являются опциональными и могут быть пропущены для быстрого MVP
- Каждая задача ссылается на конкретные требования для трассируемости
- Checkpoint-задачи обеспечивают инкрементальную валидацию
- `better-sqlite3` использует синхронный API — не нужен `async/await` для операций с БД
- Все директории (`logs/`, `screenshots/`, `cookies/`) создаются автоматически при старте
- Graceful shutdown гарантирует, что воркеры не прерываются на середине шага

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["5.1", "6.1", "7.1", "8.1"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["9.2"] },
    { "id": 7, "tasks": ["10.1"] }
  ]
}
```
