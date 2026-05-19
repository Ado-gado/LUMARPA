'use strict';

/**
 * CLI-инструмент управления базой данных.
 *
 * Использование:
 *   node scripts/db.js <команда> [аргументы]
 *
 * Команды:
 *
 *   -- GMX аккаунты --
 *   emails import <file>          Импорт GMX аккаунтов (email:password построчно или JSON)
 *   emails list                   Список всех email аккаунтов со статусами
 *   emails stats                  Статистика по статусам
 *   emails reset-failed           Вернуть failed → available (для повторной попытки)
 *
 *   -- Прокси для AdsPower (браузер) --
 *   proxies import <file>         Импорт прокси для браузера
 *   proxies list                  Список прокси браузера со статусами
 *   proxies stats                 Статистика по статусам
 *   proxies reset-failed          Вернуть failed → available
 *
 *   -- Прокси для IMAP (почта) --
 *   imap-proxies import <file>    Импорт IMAP-прокси
 *   imap-proxies list             Список IMAP-прокси
 *
 *   -- Зарегистрированные аккаунты --
 *   registered list               Список успешно зарегистрированных аккаунтов
 *   registered export <file>      Экспорт в файл (email:password построчно)
 *
 *   -- Забаненные / проблемные --
 *   banned list                   Список failed email аккаунтов
 *   banned export <file>          Экспорт забаненных в файл
 *
 *   -- Общее --
 *   stats                         Общая статистика по всем таблицам
 */

const fs      = require('fs');
const path    = require('path');
const Database = require('better-sqlite3');

// ─── Конфигурация ─────────────────────────────────────────────────────────────
require('dotenv').config();
const DB_PATH = process.env.DB_PATH || './data/accounts.db';

// ─── Утилиты ──────────────────────────────────────────────────────────────────
function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`  ✓ ${msg}`); }
function err(msg)  { console.error(`  ✗ ${msg}`); }
function info(msg) { console.log(`  · ${msg}`); }

function openDb() {
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureTables(db);
  return db;
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      protocol TEXT NOT NULL DEFAULT 'socks5',
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(host, port)
    );
    CREATE TABLE IF NOT EXISTS imap_proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      protocol TEXT NOT NULL DEFAULT 'socks5',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(host, port)
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      proxy_id INTEGER NOT NULL,
      profile_id INTEGER,
      status TEXT NOT NULL DEFAULT 'success',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER,
      proxy_id INTEGER,
      step TEXT NOT NULL,
      error_message TEXT NOT NULL,
      error_stack TEXT,
      screenshot_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS adspower_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL UNIQUE,
      email_id INTEGER NOT NULL,
      proxy_id INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_emails_status   ON emails(status);
    CREATE INDEX IF NOT EXISTS idx_proxies_status  ON proxies(status);
    CREATE INDEX IF NOT EXISTS idx_imap_proxies_id ON imap_proxies(id);
  `);
}

// ─── Парсеры файлов ───────────────────────────────────────────────────────────

/** Парсит файл email:password (построчно или JSON) */
function parseEmailsFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(i => i.email && i.password)
        .map(i => ({ email: i.email.trim(), password: i.password.trim() }));
    }
  } catch {}
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes(':'))
    .map(line => {
      const idx = line.indexOf(':');
      return { email: line.slice(0, idx).trim(), password: line.slice(idx + 1).trim() };
    })
    .filter(a => a.email && a.password);
}

/** Парсит файл прокси (построчно или JSON) */
function parseProxiesFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.filter(p => p.host && p.port).map(p => ({
        host:     p.host,
        port:     parseInt(p.port),
        username: p.username || p.user || null,
        password: p.password || p.pass || null,
        protocol: p.protocol || p.type || 'socks5',
      }));
    }
  } catch {}
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      // Формат URL: socks5://user:pass@host:port
      if (line.includes('://')) {
        try {
          const url = new URL(line);
          return {
            protocol: url.protocol.replace(':', '') || 'socks5',
            host:     url.hostname,
            port:     parseInt(url.port) || 1080,
            username: url.username ? decodeURIComponent(url.username) : null,
            password: url.password ? decodeURIComponent(url.password) : null,
          };
        } catch { return null; }
      }
      // Формат: host:port[:user[:pass]]
      const parts = line.split(':');
      if (parts.length < 2) return null;
      return {
        protocol: 'socks5',
        host:     parts[0],
        port:     parseInt(parts[1]),
        username: parts[2] || null,
        password: parts[3] || null,
      };
    })
    .filter(Boolean);
}

// ─── Форматирование таблицы ───────────────────────────────────────────────────

function printTable(rows, columns) {
  if (rows.length === 0) { info('(пусто)'); return; }
  const widths = columns.map(col =>
    Math.max(col.label.length, ...rows.map(r => String(r[col.key] ?? '').length))
  );
  const header = columns.map((col, i) => col.label.padEnd(widths[i])).join('  ');
  const divider = widths.map(w => '─'.repeat(w)).join('  ');
  log('  ' + header);
  log('  ' + divider);
  for (const row of rows) {
    log('  ' + columns.map((col, i) => String(row[col.key] ?? '').padEnd(widths[i])).join('  '));
  }
}

// ─── Команды: emails ──────────────────────────────────────────────────────────

function cmdEmailsSetOnly(email) {
  if (!email) { err('Укажи email: node scripts/db.js emails set-only <email>'); process.exit(1); }
  const db = openDb();
  const r1 = db.prepare("UPDATE emails SET status='parked', attempts=0 WHERE status='available' AND email != ?").run(email);
  const r2 = db.prepare("UPDATE emails SET status='available', attempts=0 WHERE email = ?").run(email);
  db.close();
  if (r2.changes === 0) { err(`Email не найден: ${email}`); return; }
  ok(`Только ${email} — available`);
  info(`Запарковано остальных: ${r1.changes}`);
}

function cmdEmailsImport(filePath) {
  if (!fs.existsSync(filePath)) { err(`Файл не найден: ${filePath}`); process.exit(1); }
  const accounts = parseEmailsFile(filePath);
  if (accounts.length === 0) { err('Аккаунты не найдены в файле'); process.exit(1); }
  log(`\nИмпорт GMX аккаунтов из: ${filePath}`);
  info(`Найдено: ${accounts.length}`);

  const db = openDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO emails (email, password, status, attempts) VALUES (@email, @password, 'available', 0)`
  );
  let added = 0, skipped = 0;
  db.transaction(() => {
    for (const a of accounts) {
      const r = insert.run(a);
      if (r.changes > 0) added++; else skipped++;
    }
  })();
  db.close();

  ok(`Добавлено: ${added}`);
  info(`Пропущено (дубли): ${skipped}`);
}

function cmdEmailsList() {
  const db = openDb();
  const rows = db.prepare(
    `SELECT id, email, status, attempts, created_at FROM emails ORDER BY id ASC LIMIT 100`
  ).all();
  db.close();
  log('\nGMX аккаунты (последние 100):');
  if (rows.length === 0) { info('(пусто)'); return; }
  printTable(rows, [
    { key: 'id',         label: 'ID'       },
    { key: 'email',      label: 'Email'    },
    { key: 'status',     label: 'Статус'   },
    { key: 'attempts',   label: 'Попытки'  },
    { key: 'created_at', label: 'Добавлен' },
  ]);
  log(`\n  Всего: ${rows.length}`);
}

function cmdEmailsStats() {
  const db = openDb();
  const rows = db.prepare(
    `SELECT status, COUNT(*) as count FROM emails GROUP BY status ORDER BY count DESC`
  ).all();
  const total = rows.reduce((s, r) => s + r.count, 0);
  db.close();
  log('\nСтатистика GMX аккаунтов:');
  printTable(rows, [
    { key: 'status', label: 'Статус'    },
    { key: 'count',  label: 'Количество' },
  ]);
  log(`\n  Итого: ${total}`);
}

function cmdEmailsResetFailed() {
  const db = openDb();
  const r = db.prepare(
    `UPDATE emails SET status = 'available', attempts = 0, updated_at = datetime('now') WHERE status = 'failed'`
  ).run();
  db.close();
  ok(`Сброшено failed → available: ${r.changes} аккаунтов`);
}

// ─── Команды: proxies (AdsPower) ─────────────────────────────────────────────

function cmdProxiesImport(filePath) {
  if (!fs.existsSync(filePath)) { err(`Файл не найден: ${filePath}`); process.exit(1); }
  const proxies = parseProxiesFile(filePath);
  if (proxies.length === 0) { err('Прокси не найдены в файле'); process.exit(1); }
  log(`\nИмпорт прокси (AdsPower) из: ${filePath}`);
  info(`Найдено: ${proxies.length}`);

  const db = openDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO proxies (host, port, username, password, protocol, status)
     VALUES (@host, @port, @username, @password, @protocol, 'available')`
  );
  let added = 0, skipped = 0;
  db.transaction(() => {
    for (const p of proxies) {
      const r = insert.run(p);
      if (r.changes > 0) added++; else skipped++;
    }
  })();
  db.close();

  ok(`Добавлено: ${added}`);
  info(`Пропущено (дубли): ${skipped}`);
}

function cmdProxiesList() {
  const db = openDb();
  const rows = db.prepare(
    `SELECT id, protocol, host, port, username, status FROM proxies ORDER BY id DESC LIMIT 100`
  ).all();
  db.close();
  log('\nПрокси для AdsPower (последние 100):');
  printTable(rows, [
    { key: 'id',       label: 'ID'       },
    { key: 'protocol', label: 'Протокол' },
    { key: 'host',     label: 'Host'     },
    { key: 'port',     label: 'Port'     },
    { key: 'username', label: 'User'     },
    { key: 'status',   label: 'Статус'   },
  ]);
}

function cmdProxiesStats() {
  const db = openDb();
  const rows = db.prepare(
    `SELECT status, COUNT(*) as count FROM proxies GROUP BY status ORDER BY count DESC`
  ).all();
  const total = rows.reduce((s, r) => s + r.count, 0);
  db.close();
  log('\nСтатистика прокси (AdsPower):');
  printTable(rows, [
    { key: 'status', label: 'Статус'    },
    { key: 'count',  label: 'Количество' },
  ]);
  log(`\n  Итого: ${total}`);
}

function cmdProxiesResetFailed() {
  const db = openDb();
  const r = db.prepare(
    `UPDATE proxies SET status = 'available', updated_at = datetime('now') WHERE status = 'failed'`
  ).run();
  db.close();
  ok(`Сброшено failed → available: ${r.changes} прокси`);
}

// ─── Команды: imap-proxies ────────────────────────────────────────────────────

function cmdImapProxiesImport(filePath) {
  if (!fs.existsSync(filePath)) { err(`Файл не найден: ${filePath}`); process.exit(1); }
  const proxies = parseProxiesFile(filePath);
  if (proxies.length === 0) { err('Прокси не найдены в файле'); process.exit(1); }
  log(`\nИмпорт IMAP-прокси из: ${filePath}`);
  info(`Найдено: ${proxies.length}`);

  const db = openDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO imap_proxies (host, port, username, password, protocol)
     VALUES (@host, @port, @username, @password, @protocol)`
  );
  let added = 0, skipped = 0;
  db.transaction(() => {
    for (const p of proxies) {
      const r = insert.run(p);
      if (r.changes > 0) added++; else skipped++;
    }
  })();
  db.close();

  ok(`Добавлено: ${added}`);
  info(`Пропущено (дубли): ${skipped}`);
}

function cmdImapProxiesList() {
  const db = openDb();
  const rows = db.prepare(
    `SELECT id, protocol, host, port, username FROM imap_proxies ORDER BY id ASC`
  ).all();
  db.close();
  log('\nIMAP-прокси (round-robin для GMX):');
  printTable(rows, [
    { key: 'id',       label: 'ID'       },
    { key: 'protocol', label: 'Протокол' },
    { key: 'host',     label: 'Host'     },
    { key: 'port',     label: 'Port'     },
    { key: 'username', label: 'User'     },
  ]);
  log(`\n  Всего: ${rows.length}`);
}

// ─── Команды: registered ─────────────────────────────────────────────────────

function cmdRegisteredList() {
  const db = openDb();
  const rows = db.prepare(`
    SELECT e.id, e.email, r.credits, r.created_at as registered_at
    FROM registrations r
    JOIN emails e ON e.id = r.email_id
    WHERE r.status = 'success'
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all();
  db.close();
  log('\nЗарегистрированные аккаунты (последние 100):');
  printTable(rows, [
    { key: 'id',            label: 'ID'            },
    { key: 'email',         label: 'Email'         },
    { key: 'credits',       label: 'Кредиты'       },
    { key: 'registered_at', label: 'Зарегистрирован' },
  ]);
  log(`\n  Показано: ${rows.length}`);
}

function cmdRegisteredExport(filePath) {
  const db = openDb();
  const rows = db.prepare(`
    SELECT e.email, e.password
    FROM registrations r
    JOIN emails e ON e.id = r.email_id
    WHERE r.status = 'success'
    ORDER BY r.created_at ASC
  `).all();
  db.close();

  if (rows.length === 0) { info('Нет зарегистрированных аккаунтов'); return; }

  const content = rows.map(r => `${r.email}:${r.password}`).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
  ok(`Экспортировано ${rows.length} аккаунтов → ${filePath}`);
}

// ─── Команды: banned ─────────────────────────────────────────────────────────

function cmdBannedList() {
  const db = openDb();
  const rows = db.prepare(`
    SELECT e.id, e.email, e.attempts, e.updated_at as failed_at,
           (SELECT el.error_message FROM error_logs el WHERE el.email_id = e.id ORDER BY el.id DESC LIMIT 1) as last_error
    FROM emails e
    WHERE e.status = 'failed'
    ORDER BY e.updated_at DESC
    LIMIT 100
  `).all();
  db.close();
  log('\nЗабаненные / проблемные аккаунты:');
  printTable(rows, [
    { key: 'id',         label: 'ID'          },
    { key: 'email',      label: 'Email'       },
    { key: 'attempts',   label: 'Попытки'     },
    { key: 'failed_at',  label: 'Дата'        },
    { key: 'last_error', label: 'Последняя ошибка' },
  ]);
  log(`\n  Показано: ${rows.length}`);
}

function cmdBannedExport(filePath) {
  const db = openDb();
  const rows = db.prepare(
    `SELECT email, password FROM emails WHERE status = 'failed' ORDER BY updated_at DESC`
  ).all();
  db.close();

  if (rows.length === 0) { info('Нет забаненных аккаунтов'); return; }

  const content = rows.map(r => `${r.email}:${r.password}`).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
  ok(`Экспортировано ${rows.length} забаненных → ${filePath}`);
}

// ─── Команда: stats (общая) ───────────────────────────────────────────────────

function cmdStats() {
  const db = openDb();

  const emailStats = db.prepare(
    `SELECT status, COUNT(*) as count FROM emails GROUP BY status`
  ).all();
  const proxyStats = db.prepare(
    `SELECT status, COUNT(*) as count FROM proxies GROUP BY status`
  ).all();
  const imapCount  = db.prepare(`SELECT COUNT(*) as count FROM imap_proxies`).get();
  const regCount   = db.prepare(`SELECT COUNT(*) as count FROM registrations WHERE status = 'success'`).get();
  const errCount   = db.prepare(`SELECT COUNT(*) as count FROM error_logs`).get();

  db.close();

  log('\n══════════════════════════════════════');
  log('  Общая статистика');
  log('══════════════════════════════════════');

  log('\n  GMX аккаунты:');
  for (const r of emailStats) {
    info(`${r.status.padEnd(12)} ${r.count}`);
  }

  log('\n  Прокси (AdsPower):');
  for (const r of proxyStats) {
    info(`${r.status.padEnd(12)} ${r.count}`);
  }

  log('\n  IMAP-прокси:');
  info(`всего          ${imapCount.count}`);

  log('\n  Результаты:');
  info(`зарегистрировано  ${regCount.count}`);
  info(`ошибок в логах    ${errCount.count}`);

  log('');
}

// ─── Справка ──────────────────────────────────────────────────────────────────

function printHelp() {
  log(`
Управление базой данных аккаунтов.

Использование:
  node scripts/db.js <команда> [аргументы]

GMX аккаунты:
  emails import <file>        Импорт из файла (email:password или JSON)
  emails list                 Список аккаунтов
  emails stats                Статистика по статусам
  emails set-only <email>     Оставить только этот email в очереди (остальные → parked)
  emails reset-failed         Сбросить failed → available

Прокси для AdsPower (браузер):
  proxies import <file>       Импорт прокси
  proxies list                Список прокси
  proxies stats               Статистика
  proxies reset-failed        Сбросить failed → available

Прокси для IMAP (почта, round-robin):
  imap-proxies import <file>  Импорт IMAP-прокси
  imap-proxies list           Список IMAP-прокси

Зарегистрированные аккаунты:
  registered list             Список успешных регистраций
  registered export <file>    Экспорт в файл email:password

Забаненные / проблемные:
  banned list                 Список failed аккаунтов с последней ошибкой
  banned export <file>        Экспорт в файл

Общее:
  stats                       Общая статистика по всем таблицам

Форматы файлов прокси:
  host:port
  host:port:username:password
  socks5://username:password@host:port
  http://username:password@host:port
  JSON: [{"host":"...","port":1080,"username":"...","password":"...","protocol":"socks5"}]
`);
}

// ─── Роутер команд ────────────────────────────────────────────────────────────

const [,, entity, action, arg] = process.argv;

if (!entity) { printHelp(); process.exit(0); }

const routes = {
  'emails import':          () => cmdEmailsImport(action),
  'emails list':            () => cmdEmailsList(),
  'emails stats':           () => cmdEmailsStats(),
  'emails reset-failed':    () => cmdEmailsResetFailed(),

  'proxies import':         () => cmdProxiesImport(action),
  'proxies list':           () => cmdProxiesList(),
  'proxies stats':          () => cmdProxiesStats(),
  'proxies reset-failed':   () => cmdProxiesResetFailed(),

  'imap-proxies import':    () => cmdImapProxiesImport(action),
  'imap-proxies list':      () => cmdImapProxiesList(),

  'registered list':        () => cmdRegisteredList(),
  'registered export':      () => cmdRegisteredExport(action),

  'banned list':            () => cmdBannedList(),
  'banned export':          () => cmdBannedExport(action),

  'stats':                  () => cmdStats(),
};

// Собираем ключ: для 'stats' entity уже полный ключ, иначе 'entity action'
const key = action ? `${entity} ${action}` : entity;

// Для команд с файловым аргументом (import/export) сдвигаем аргументы
const fileArg = arg || action;

// Переопределяем роуты с учётом сдвига аргументов
const routeMap = {
  'emails import':          () => cmdEmailsImport(fileArg),
  'emails set-only':        () => cmdEmailsSetOnly(fileArg),
  'emails list':            () => cmdEmailsList(),
  'emails stats':           () => cmdEmailsStats(),
  'emails reset-failed':    () => cmdEmailsResetFailed(),

  'proxies import':         () => cmdProxiesImport(fileArg),
  'proxies list':           () => cmdProxiesList(),
  'proxies stats':          () => cmdProxiesStats(),
  'proxies reset-failed':   () => cmdProxiesResetFailed(),

  'imap-proxies import':    () => cmdImapProxiesImport(fileArg),
  'imap-proxies list':      () => cmdImapProxiesList(),

  'registered list':        () => cmdRegisteredList(),
  'registered export':      () => cmdRegisteredExport(fileArg),

  'banned list':            () => cmdBannedList(),
  'banned export':          () => cmdBannedExport(fileArg),

  'stats':                  () => cmdStats(),
};

const handler = routeMap[key];
if (!handler) {
  err(`Неизвестная команда: ${key}`);
  printHelp();
  process.exit(1);
}

try {
  handler();
} catch (e) {
  err(e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
}
