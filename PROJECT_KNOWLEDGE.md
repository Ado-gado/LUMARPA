# PROJECT_KNOWLEDGE.md

> Главная документация проекта. Актуальное состояние на 2026-05-19.
> Агент не должен выдумывать архитектуру, API и логику — всё описано здесь.

---

## 1. Описание проекта

Автоматизация регистрации аккаунтов на целевом сайте.

**Стек:**
- **AdsPower** — антидетект-браузер, управляется через Local API
- **Playwright** — управляет браузером через CDP (не создаёт браузер сам)
- **SQLite / better-sqlite3** — база данных, центральный контроллер состояния
- **Capsolver** — решение капч
- **GMX почта** — получение кодов подтверждения через IMAP
- **socks5 прокси** — два отдельных пула: для браузера (AdsPower) и для IMAP

---

## 2. Структура проекта

```
src/
  index.js              — точка входа, запускает N воркеров параллельно
  worker.js             — оркестратор одного цикла регистрации (13 шагов)
  config.js             — загрузка .env конфига
  logger.js             — winston + ротация логов по дням
  database/
    index.js            — фабрика БД
    sqlite.js           — реализация SQLite (better-sqlite3)
  services/
    adspower.js         — AdsPower Local API (создание/запуск/стоп профилей)
    email.js            — GMX IMAP через socks5 прокси
    imap-proxy-pool.js  — round-robin пул IMAP-прокси
    captcha.js          — Capsolver API
    cookies.js          — экспорт cookies после регистрации
scripts/
  db.js                 — CLI управления БД (импорт/просмотр всех данных)
config/
  .env.example          — шаблон конфигурации
logs/                   — файлы логов (ротация по дням)
screenshots/            — скриншоты ошибок
cookies/                — сохранённые cookies
data/
  accounts.db           — SQLite база данных
```

---

## 3. Общая схема процесса (worker.js)

```
STEP_1  Взять email из БД (status = 'available') → поставить 'in_progress'
STEP_2  Взять прокси из БД (status = 'available') → поставить 'in_use'
STEP_3  Проверить прокси TCP-подключением → создать профиль AdsPower
STEP_4  Запустить профиль AdsPower → получить CDP endpoint
STEP_5  Подключить Playwright через CDP
STEP_6  Заблокировать медиа-ресурсы (image/media/font/stylesheet)
STEP_7  Открыть TARGET_URL
STEP_8  Заполнить форму регистрации (TODO: реальные селекторы)
STEP_9  Решить капчу если обнаружена (Capsolver)
STEP_10 Отправить форму (TODO: реальные селекторы)
STEP_11 Ждать код подтверждения из GMX почты (IMAP + round-robin прокси)
STEP_12 Ввести код и подтвердить (TODO: реальные селекторы)
STEP_13 Сохранить cookies, пометить email 'registered', прокси 'used'
```

При ошибке на любом шаге:
- Скриншот → `screenshots/`
- Запись в `error_logs`
- Email → `available` (если попыток < MAX_RETRIES) или `failed`
- Прокси → `failed` если ProxyCheckError/сетевая ошибка, иначе `available`
- AdsPower профиль всегда останавливается в `finally`

---

## 4. База данных (SQLite)

**Путь:** `./data/accounts.db`
**Режим:** WAL (поддерживает параллельные воркеры)

### Таблицы

#### emails — GMX аккаунты
| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER PK | |
| email | TEXT UNIQUE | Адрес GMX почты |
| password | TEXT | Пароль IMAP |
| status | TEXT | `available` / `in_progress` / `registered` / `failed` |
| attempts | INTEGER | Счётчик попыток |
| created_at | TEXT | |
| updated_at | TEXT | |

#### proxies — прокси для AdsPower (браузер)
| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER PK | |
| host | TEXT | |
| port | INTEGER | |
| username | TEXT | |
| password | TEXT | |
| protocol | TEXT | `socks5` / `http` |
| status | TEXT | `available` / `in_use` / `used` / `failed` |
| created_at | TEXT | |
| updated_at | TEXT | |

#### imap_proxies — прокси для IMAP (round-robin, без статуса)
| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER PK | |
| host | TEXT | |
| port | INTEGER | |
| username | TEXT | |
| password | TEXT | |
| protocol | TEXT | `socks5` |
| created_at | TEXT | |

#### registrations — успешные регистрации
| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER PK | |
| email_id | INTEGER | FK → emails |
| proxy_id | INTEGER | FK → proxies |
| profile_id | INTEGER | |
| status | TEXT | `success` |
| created_at | TEXT | |

#### error_logs — лог ошибок
| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER PK | |
| email_id | INTEGER | |
| proxy_id | INTEGER | |
| step | TEXT | STEP_1..STEP_13 |
| error_message | TEXT | |
| error_stack | TEXT | |
| screenshot_path | TEXT | |
| created_at | TEXT | |

#### adspower_profiles — созданные профили
| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER PK | |
| profile_id | TEXT UNIQUE | ID профиля в AdsPower |
| email_id | INTEGER | |
| proxy_id | INTEGER | |
| group_id | TEXT | |
| created_at | TEXT | |

---

## 5. AdsPower

**API URL:** `http://local.adspower.net:50325`
**Group ID:** `9524590` (группа "RPA BOT")

**Fingerprint каждого профиля:**
- User-Agent: Chrome 124 / Windows 10
- WebRTC: disabled
- Таймзона: автоматически по IP
- Canvas/WebGL/Audio: шум включён
- Разрешение: 1920×1080
- CPU: 4 ядра, RAM: 8GB
- Язык: en-US

**Проверка прокси перед созданием профиля:**
Перед `POST /api/v1/user/create` делается TCP-подключение к прокси (таймаут 10с).
Если недоступен — бросается `ProxyCheckError`, воркер помечает прокси `failed` и берёт следующий.

**Эндпоинты:**
- `POST /api/v1/user/create` — создать профиль
- `GET /api/v1/browser/start?user_id=<id>` — запустить, вернёт `data.ws.puppeteer` (CDP URL)
- `GET /api/v1/browser/stop?user_id=<id>` — остановить
- `POST /api/v1/user/delete` — удалить

---

## 6. Email / GMX IMAP

**Почтовый сервер:** `imap.gmx.com:993` (SSL)

**Как работает:**
- Каждый опрос почты берёт следующий прокси из round-robin пула (`imap_proxies`)
- Подключение через socks5: `SocksClient.createConnection()` → передаётся в `ImapFlow` как `socket`
- Проверяются папки: `INBOX`, `Junk`
- Берутся последние 5 писем
- Код извлекается регулярным выражением `CODE_REGEX` (по умолчанию `\d{4,8}`)
- Опрос каждые 5 секунд, таймаут `EMAIL_TIMEOUT_MS` (по умолчанию 90 сек)

**Текущие IMAP-прокси (5 штук, все проверены):**
- `45.153.20.240:12463` (socks5, user: hFkqco)
- `45.153.20.240:12462` (socks5, user: hFkqco)
- `45.153.20.217:11685` (socks5, user: AEw4k5)
- `45.153.20.217:11686` (socks5, user: AEw4k5)
- `45.153.20.217:11687` (socks5, user: AEw4k5)

---

## 7. Capsolver

**Когда вызывается:** если на странице обнаружена reCAPTCHA или hCaptcha.

**Поддерживаемые типы:**
- `ReCaptchaV2TaskProxyless`
- `ReCaptchaV3TaskProxyless`
- `HCaptchaTaskProxyless`

**Схема:** `createTask` → polling `getTaskResult` каждые 3с → `solution.gRecaptchaResponse`

---

## 8. CLI управления данными (scripts/db.js)

```bash
# GMX аккаунты
node scripts/db.js emails import <file>      # файл: email:password построчно
node scripts/db.js emails list
node scripts/db.js emails stats
node scripts/db.js emails reset-failed       # failed → available

# Прокси для AdsPower
node scripts/db.js proxies import <file>
node scripts/db.js proxies list
node scripts/db.js proxies stats
node scripts/db.js proxies reset-failed

# IMAP прокси (round-robin)
node scripts/db.js imap-proxies import <file>
node scripts/db.js imap-proxies list

# Результаты
node scripts/db.js registered list
node scripts/db.js registered export <file>

# Забаненные
node scripts/db.js banned list
node scripts/db.js banned export <file>

# Общая статистика
node scripts/db.js stats
```

**Форматы файлов прокси:**
```
host:port
host:port:username:password
socks5://username:password@host:port
```

---

## 9. Конфигурация (.env)

```env
TARGET_URL=                          # URL страницы регистрации (TODO)
ADSPOWER_API_URL=http://local.adspower.net:50325
ADSPOWER_GROUP_ID=9524590
CAPSOLVER_API_KEY=                   # TODO
MAX_RETRIES=3
EMAIL_TIMEOUT_MS=90000
PLAYWRIGHT_TIMEOUT_MS=30000
PROXY_PROTOCOL=socks5
CONCURRENCY=1
DB_TYPE=sqlite
DB_PATH=./data/accounts.db
LOG_LEVEL=info
CODE_REGEX=\d{4,8}
EMAIL_SENDER_PATTERN=                # домен отправителя кода (опционально)
```

---

## 10. Текущее состояние БД

| Таблица | Кол-во | Статус |
|---------|--------|--------|
| emails (GMX) | 10 | available |
| proxies (AdsPower) | 3 | available |
| imap_proxies | 5 | все рабочие |
| registrations | 0 | — |

---

## 11. Что осталось сделать

### Обязательно перед запуском:
1. **Создать `.env`** — скопировать из `config/.env.example`, заполнить `TARGET_URL` и `CAPSOLVER_API_KEY`
2. **Селекторы формы** — в `src/worker.js` заменить заглушки на реальные CSS-селекторы целевого сайта (STEP 8, 10, 12)
3. **Проверить тип капчи** — открыть страницу регистрации вручную и посмотреть есть ли капча

### После первого запуска:
4. **Веб-интерфейс** — дашборд для управления (запуск/стоп, статистика, добавление данных)
5. **Масштабирование** — увеличить `CONCURRENCY` для параллельных воркеров

---

## 12. Ограничения MVP

- Один поток (CONCURRENCY=1) — один воркер за раз
- Без веб-интерфейса — управление через CLI
- Без Redis/BullMQ — очередь через SQLite
- Прокси AdsPower помечаются `used` после успешной регистрации (не переиспользуются)
- IMAP прокси ротируются бесконечно (не расходуются)
