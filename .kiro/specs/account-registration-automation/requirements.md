# Requirements Document

## Introduction

Система автоматизации регистрации аккаунтов — это серверное Node.js-приложение, которое выполняет полный цикл регистрации на целевом сайте: от выбора email и прокси из базы данных до подтверждения email-кода и сохранения cookies. Система использует AdsPower для управления браузерными профилями, Playwright для автоматизации браузера, Capsolver для решения капч и firstmail.ltd IMAP API для получения кодов подтверждения. Центральным контроллером состояния является база данных SQLite (с возможностью перехода на PostgreSQL без переписывания логики).

---

## Glossary

- **System** — система автоматизации регистрации аккаунтов в целом
- **RegistrationWorker** — модуль-оркестратор, управляющий полным циклом регистрации одного аккаунта
- **DatabaseModule** — модуль абстракции над базой данных (SQLite/PostgreSQL)
- **AdsPowerService** — модуль интеграции с AdsPower Local API
- **EmailService** — модуль получения кода подтверждения через firstmail.ltd IMAP API
- **CaptchaService** — модуль интеграции с Capsolver для решения капч
- **CookiesExporter** — модуль сохранения cookies браузера в файловую систему
- **Logger** — модуль логирования всех событий и ошибок
- **Email** — запись в таблице `emails` БД, содержащая адрес, статус и счётчик попыток
- **Proxy** — запись в таблице `proxies` БД, содержащая параметры прокси и статус
- **AdsPowerProfile** — браузерный профиль, созданный в AdsPower и привязанный к прокси
- **CDPEndpoint** — URL Chrome DevTools Protocol, возвращаемый AdsPower при запуске профиля
- **ConfirmationCode** — числовой или буквенно-цифровой код из письма подтверждения
- **max_retries** — максимальное количество попыток регистрации для одного email (конфигурируемый параметр)
- **EmailStatus** — перечисление: `available`, `in_progress`, `registered`, `failed`
- **ProxyStatus** — перечисление: `available`, `in_use`, `used`, `failed`

---

## Requirements

### Требование 1: Выбор email из базы данных

**User Story:** Как оператор системы, я хочу, чтобы система автоматически выбирала свободный email для регистрации, чтобы не управлять очередью вручную.

#### Критерии приёмки

1. WHEN RegistrationWorker начинает новый цикл регистрации, THE DatabaseModule SHALL выбрать одну запись из таблицы `emails` со статусом `available` и значением `attempts` меньше `max_retries`.
2. WHEN DatabaseModule выбирает email, THE DatabaseModule SHALL атомарно обновить статус этого email на `in_progress`, чтобы исключить повторный выбор параллельными процессами.
3. IF в таблице `emails` нет записей со статусом `available` и `attempts` < `max_retries`, THEN THE RegistrationWorker SHALL завершить работу и записать в Logger сообщение об отсутствии доступных email.
4. THE DatabaseModule SHALL предоставлять единый интерфейс запросов, совместимый как с SQLite, так и с PostgreSQL, без изменения логики вызывающего кода.

---

### Требование 2: Выбор прокси из базы данных

**User Story:** Как оператор системы, я хочу, чтобы система автоматически выбирала свободный прокси, чтобы каждая регистрация проходила через уникальный IP.

#### Критерии приёмки

1. WHEN RegistrationWorker получил email, THE DatabaseModule SHALL выбрать одну запись из таблицы `proxies` со статусом `available`.
2. WHEN DatabaseModule выбирает прокси, THE DatabaseModule SHALL атомарно обновить статус этого прокси на `in_use`.
3. IF в таблице `proxies` нет записей со статусом `available`, THEN THE RegistrationWorker SHALL вернуть выбранный email в статус `available`, завершить цикл и записать в Logger сообщение об отсутствии доступных прокси.

---

### Требование 3: Создание и запуск профиля AdsPower

**User Story:** Как оператор системы, я хочу, чтобы каждая регистрация выполнялась в изолированном браузерном профиле с привязанным прокси, чтобы аккаунты не были связаны между собой.

#### Критерии приёмки

1. WHEN RegistrationWorker получил email и прокси, THE AdsPowerService SHALL создать новый браузерный профиль через AdsPower Local API в указанной группе с привязкой выбранного прокси.
2. WHEN AdsPowerService создал профиль, THE AdsPowerService SHALL запустить этот профиль через AdsPower Local API и получить CDPEndpoint.
3. WHEN AdsPowerService получил CDPEndpoint, THE AdsPowerService SHALL передать его в RegistrationWorker для подключения Playwright.
4. WHEN AdsPowerService создал профиль, THE DatabaseModule SHALL сохранить идентификатор профиля в таблице `adspower_profiles` с привязкой к email и прокси.
5. IF AdsPower Local API возвращает ошибку при создании или запуске профиля, THEN THE RegistrationWorker SHALL зафиксировать ошибку, выполнить процедуру обработки ошибок (Требование 8) и завершить цикл.

---

### Требование 4: Автоматизация браузера через Playwright

**User Story:** Как оператор системы, я хочу, чтобы система автоматически заполняла и отправляла форму регистрации, чтобы исключить ручной труд.

#### Критерии приёмки

1. WHEN RegistrationWorker получил CDPEndpoint, THE RegistrationWorker SHALL подключить Playwright к браузеру через этот CDPEndpoint.
2. WHEN Playwright подключён к браузеру, THE RegistrationWorker SHALL включить блокировку сетевых запросов к ресурсам типов: `image`, `media`, `font`, `stylesheet` для ускорения загрузки страниц.
3. WHEN блокировка ресурсов включена, THE RegistrationWorker SHALL открыть URL целевого сайта регистрации.
4. WHEN страница регистрации загружена, THE RegistrationWorker SHALL заполнить поля формы: email, пароль и дополнительные поля согласно конфигурации.
5. IF на странице регистрации обнаружена капча, THEN THE RegistrationWorker SHALL передать задачу в CaptchaService и дождаться решения перед отправкой формы.
6. WHEN форма заполнена и капча решена (если присутствовала), THE RegistrationWorker SHALL отправить форму регистрации.
7. IF Playwright не может найти ожидаемый элемент формы в течение заданного таймаута, THEN THE RegistrationWorker SHALL зафиксировать ошибку и выполнить процедуру обработки ошибок (Требование 8).

---

### Требование 5: Решение капчи через Capsolver

**User Story:** Как оператор системы, я хочу, чтобы система автоматически решала капчи, чтобы регистрация не прерывалась на этом шаге.

#### Критерии приёмки

1. WHEN RegistrationWorker обнаружил капчу на странице, THE CaptchaService SHALL отправить задачу на решение в Capsolver API с параметрами, соответствующими типу капчи.
2. WHEN Capsolver API вернул решение, THE CaptchaService SHALL передать токен решения в RegistrationWorker.
3. WHEN RegistrationWorker получил токен решения, THE RegistrationWorker SHALL вставить токен в соответствующее поле формы.
4. IF Capsolver API возвращает ошибку или таймаут, THEN THE CaptchaService SHALL вернуть ошибку в RegistrationWorker, который выполнит процедуру обработки ошибок (Требование 8).

---

### Требование 6: Получение кода подтверждения email

**User Story:** Как оператор системы, я хочу, чтобы система автоматически получала код подтверждения из письма, чтобы завершить регистрацию без ручного вмешательства.

#### Критерии приёмки

1. WHEN форма регистрации отправлена, THE EmailService SHALL подключиться к firstmail.ltd IMAP API с использованием токена авторизации.
2. WHEN EmailService подключён, THE EmailService SHALL ожидать входящего письма с кодом подтверждения для указанного email в течение заданного таймаута (конфигурируемый параметр, не менее 60 секунд).
3. WHEN письмо с кодом получено, THE EmailService SHALL извлечь ConfirmationCode из тела письма с помощью регулярного выражения.
4. WHEN EmailService извлёк ConfirmationCode, THE EmailService SHALL передать его в RegistrationWorker.
5. WHEN RegistrationWorker получил ConfirmationCode, THE RegistrationWorker SHALL ввести код в соответствующее поле формы подтверждения и отправить форму.
6. IF письмо с кодом не получено в течение таймаута, THEN THE EmailService SHALL вернуть ошибку таймаута в RegistrationWorker, который выполнит процедуру обработки ошибок (Требование 8).
7. IF EmailService не может извлечь ConfirmationCode из письма, THEN THE EmailService SHALL вернуть ошибку парсинга в RegistrationWorker, который выполнит процедуру обработки ошибок (Требование 8).

---

### Требование 7: Успешное завершение регистрации

**User Story:** Как оператор системы, я хочу, чтобы система корректно фиксировала успешную регистрацию и сохраняла все необходимые данные, чтобы аккаунт был готов к использованию.

#### Критерии приёмки

1. WHEN регистрация завершена успешно, THE DatabaseModule SHALL обновить статус email на `registered`. Повторное использование email со статусом `registered` не допускается.
2. WHEN регистрация завершена успешно, THE DatabaseModule SHALL обновить статус прокси на `used` или `available` согласно бизнес-логике конфигурации.
3. WHEN регистрация завершена успешно, THE CookiesExporter SHALL сохранить cookies браузера в файл в директории `cookies/`, где имя файла соответствует адресу email.
4. WHEN регистрация завершена успешно, THE DatabaseModule SHALL создать запись в таблице `registrations` с идентификатором email, идентификатором прокси, временной меткой и статусом `success`.
5. WHEN регистрация завершена успешно, THE Logger SHALL записать событие успешной регистрации с указанием email и временной метки.
6. WHEN все данные сохранены, THE AdsPowerService SHALL остановить браузерный профиль через AdsPower Local API.

---

### Требование 8: Обработка ошибок и восстановление

**User Story:** Как оператор системы, я хочу, чтобы система корректно обрабатывала ошибки на любом шаге, чтобы не допустить потери данных, зависших записей и бесконечных повторных попыток.

#### Критерии приёмки

1. WHEN на любом шаге цикла регистрации возникает ошибка, THE RegistrationWorker SHALL остановить выполнение текущего цикла и перейти к процедуре обработки ошибок.
2. WHEN RegistrationWorker выполняет процедуру обработки ошибок, THE RegistrationWorker SHALL сделать скриншот текущего состояния страницы браузера и сохранить его в директорию `screenshots/` с именем файла, содержащим email и временную метку.
3. WHEN RegistrationWorker выполняет процедуру обработки ошибок, THE DatabaseModule SHALL создать запись в таблице `error_logs` с полями: идентификатор email, идентификатор прокси, номер шага, текст ошибки, временная метка.
4. WHEN RegistrationWorker выполняет процедуру обработки ошибок, THE Logger SHALL записать ошибку с указанием шага, текста ошибки и email.
5. WHEN RegistrationWorker выполняет процедуру обработки ошибок, IF значение `attempts` для email меньше `max_retries`, THEN THE DatabaseModule SHALL увеличить счётчик `attempts` на 1 и вернуть статус email на `available`.
6. WHEN RegistrationWorker выполняет процедуру обработки ошибок, IF значение `attempts` для email равно `max_retries`, THEN THE DatabaseModule SHALL установить статус email на `failed`. Повторный выбор email со статусом `failed` не допускается.
7. WHEN RegistrationWorker выполняет процедуру обработки ошибок, IF ошибка связана с прокси (таймаут соединения, отказ в соединении), THEN THE DatabaseModule SHALL установить статус прокси на `failed`.
8. WHEN RegistrationWorker выполняет процедуру обработки ошибок, IF ошибка не связана с прокси, THEN THE DatabaseModule SHALL вернуть статус прокси на `available`.
9. WHEN процедура обработки ошибок завершена, THE AdsPowerService SHALL остановить браузерный профиль через AdsPower Local API.

---

### Требование 9: Логирование

**User Story:** Как оператор системы, я хочу, чтобы все события и ошибки подробно логировались, чтобы я мог отлаживать проблемы без дополнительных инструментов.

#### Критерии приёмки

1. THE Logger SHALL записывать каждое событие цикла регистрации с указанием: временной метки, уровня (info/warn/error), номера шага, email и текста сообщения.
2. WHEN возникает ошибка, THE Logger SHALL записывать полный стек вызовов (stack trace) вместе с контекстом ошибки.
3. THE Logger SHALL выводить сообщения в стандартный вывод (stdout) в формате, пригодном для чтения человеком.
4. THE Logger SHALL сохранять сообщения в файл в директории `logs/` с ротацией по дате.
5. WHERE конфигурация задаёт уровень логирования, THE Logger SHALL фильтровать сообщения ниже заданного уровня.

---

### Требование 10: Конфигурация системы

**User Story:** Как оператор системы, я хочу управлять параметрами системы через конфигурационный файл, чтобы не изменять исходный код при смене настроек.

#### Критерии приёмки

1. THE System SHALL читать конфигурацию из файла `.env` или `config.js` при запуске.
2. THE System SHALL поддерживать следующие конфигурируемые параметры: URL целевого сайта регистрации, `max_retries`, таймаут ожидания письма, таймаут ожидания элементов Playwright, API-ключ Capsolver, токен firstmail.ltd, URL AdsPower Local API, идентификатор группы AdsPower, тип прокси-протокола.
3. IF обязательный параметр конфигурации отсутствует при запуске, THEN THE System SHALL завершить работу с сообщением об ошибке, указывающим на отсутствующий параметр.
4. THE DatabaseModule SHALL поддерживать переключение между SQLite и PostgreSQL через параметр конфигурации `DB_TYPE` без изменения кода модулей, использующих DatabaseModule.

---

### Требование 11: Параллельный запуск воркеров

**User Story:** Как оператор системы, я хочу запускать несколько воркеров регистрации одновременно, чтобы увеличить скорость обработки очереди.

#### Критерии приёмки

1. THE System SHALL поддерживать запуск N параллельных RegistrationWorker через параметр конфигурации `CONCURRENCY` (целое число, минимум 1).
2. WHEN несколько RegistrationWorker запущены одновременно, THE DatabaseModule SHALL гарантировать, что каждый воркер получает уникальный email и уникальный прокси через атомарные транзакции.
3. IF два воркера одновременно пытаются взять один и тот же email или прокси, THE DatabaseModule SHALL разрешить конфликт через механизм блокировки БД — один воркер получит запись, второй получит следующую доступную.
4. WHEN `DB_TYPE=sqlite`, THE DatabaseModule SHALL использовать WAL-режим (Write-Ahead Logging) для поддержки параллельных операций чтения/записи.
5. THE System SHALL корректно завершать все активные воркеры при получении сигнала SIGINT/SIGTERM, дожидаясь завершения текущего шага каждого воркера перед выходом.

---

### Требование 12: Схема базы данных

**User Story:** Как оператор системы, я хочу, чтобы база данных была единственным источником истины о состоянии всех процессов, чтобы не использовать файлы или переменные окружения для управления очередью.

#### Критерии приёмки

1. THE DatabaseModule SHALL создавать таблицу `emails` со столбцами: `id`, `email`, `password`, `status` (EmailStatus), `attempts`, `created_at`, `updated_at`.
2. THE DatabaseModule SHALL создавать таблицу `proxies` со столбцами: `id`, `host`, `port`, `username`, `password`, `protocol`, `status` (ProxyStatus), `created_at`, `updated_at`.
3. THE DatabaseModule SHALL создавать таблицу `adspower_profiles` со столбцами: `id`, `profile_id`, `email_id`, `proxy_id`, `group_id`, `created_at`.
4. THE DatabaseModule SHALL создавать таблицу `registrations` со столбцами: `id`, `email_id`, `proxy_id`, `profile_id`, `status`, `created_at`.
5. THE DatabaseModule SHALL создавать таблицу `error_logs` со столбцами: `id`, `email_id`, `proxy_id`, `step`, `error_message`, `error_stack`, `screenshot_path`, `created_at`.
6. THE DatabaseModule SHALL применять миграции схемы при запуске, если таблицы ещё не существуют.
7. THE DatabaseModule SHALL использовать транзакции для всех операций, изменяющих статус email или прокси, чтобы гарантировать атомарность.
