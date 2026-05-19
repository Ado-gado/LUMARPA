'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

/**
 * Создаёт таблицы и индексы если не существуют.
 * @param {Database} db
 */
function migrate(db) {
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

    CREATE TABLE IF NOT EXISTS imap_proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      protocol TEXT NOT NULL DEFAULT 'socks5',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_imap_proxies_host ON imap_proxies(host);

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      protocol TEXT NOT NULL DEFAULT 'socks5',
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS adspower_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL UNIQUE,
      email_id INTEGER NOT NULL,
      proxy_id INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      proxy_id INTEGER NOT NULL,
      profile_id INTEGER,
      status TEXT NOT NULL DEFAULT 'success',
      credits TEXT,
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

    CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
    CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies(status);
  `);
}

/**
 * Создаёт SQLite-базу данных и возвращает объект с методами.
 * @param {string} dbPath — путь к файлу БД (или ':memory:' для in-memory)
 * @returns {object}
 */
function createSQLiteDatabase(dbPath) {
  // Создаём директорию если нужно (пропускаем для :memory:)
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL-режим для параллельных операций (Требование 11.4)
  db.pragma('journal_mode = WAL');
  // Включаем foreign keys
  db.pragma('foreign_keys = ON');

  migrate(db);

  // Онлайн-миграции — добавляем колонки если их нет (для существующих БД)
  const migrations = [
    `ALTER TABLE registrations ADD COLUMN credits TEXT`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* колонка уже есть */ }
  }

  // Подготовленные стейтменты — компилируются один раз
  const stmts = {
    selectAvailableEmail: db.prepare(
      `SELECT * FROM emails WHERE status = 'available' AND attempts < ? LIMIT 1`
    ),
    setEmailInProgress: db.prepare(
      `UPDATE emails SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`
    ),
    selectAvailableProxy: db.prepare(
      `SELECT * FROM proxies WHERE status = 'available' LIMIT 1`
    ),
    setProxyInUse: db.prepare(
      `UPDATE proxies SET status = 'in_use', updated_at = datetime('now') WHERE id = ?`
    ),
    releaseEmail: db.prepare(
      `UPDATE emails SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    releaseProxy: db.prepare(
      `UPDATE proxies SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    incrementEmailAttempts: db.prepare(
      `UPDATE emails SET attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`
    ),
    insertAdsPowerProfile: db.prepare(
      `INSERT INTO adspower_profiles (profile_id, email_id, proxy_id, group_id) VALUES (@profile_id, @email_id, @proxy_id, @group_id)`
    ),
    insertRegistration: db.prepare(
      `INSERT INTO registrations (email_id, proxy_id, profile_id, status, credits) VALUES (@email_id, @proxy_id, @profile_id, @status, @credits)`
    ),
    insertErrorLog: db.prepare(
      `INSERT INTO error_logs (email_id, proxy_id, step, error_message, error_stack, screenshot_path) VALUES (@email_id, @proxy_id, @step, @error_message, @error_stack, @screenshot_path)`
    ),
  };

  return {
    /**
     * Атомарно берёт email со статусом 'available' и переводит в 'in_progress'.
     * @param {number} maxRetries
     * @returns {object|null}
     */
    claimEmail(maxRetries) {
      return db.transaction(() => {
        const row = stmts.selectAvailableEmail.get(maxRetries);
        if (!row) return null;
        stmts.setEmailInProgress.run(row.id);
        return row;
      })();
    },

    /**
     * Атомарно берёт прокси со статусом 'available' и переводит в 'in_use'.
     * @returns {object|null}
     */
    claimProxy() {
      return db.transaction(() => {
        const row = stmts.selectAvailableProxy.get();
        if (!row) return null;
        stmts.setProxyInUse.run(row.id);
        return row;
      })();
    },

    /**
     * Обновляет статус email.
     * @param {number} id
     * @param {string} status — 'available' | 'registered' | 'failed'
     */
    releaseEmail(id, status) {
      stmts.releaseEmail.run(status, id);
    },

    /**
     * Обновляет статус прокси.
     * @param {number} id
     * @param {string} status — 'available' | 'used' | 'failed'
     */
    releaseProxy(id, status) {
      stmts.releaseProxy.run(status, id);
    },

    /**
     * Увеличивает счётчик попыток для email на 1.
     * @param {number} id
     */
    incrementEmailAttempts(id) {
      stmts.incrementEmailAttempts.run(id);
    },

    /**
     * Сохраняет запись профиля AdsPower.
     * @param {{ profile_id: string, email_id: number, proxy_id: number, group_id: string }} data
     * @returns {object} — результат INSERT (lastInsertRowid и т.д.)
     */
    saveAdsPowerProfile(data) {
      return stmts.insertAdsPowerProfile.run(data);
    },

    /**
     * Сохраняет запись об успешной регистрации.
     * @param {{ email_id: number, proxy_id: number, profile_id?: number, status?: string }} data
     * @returns {object}
     */
    saveRegistration(data) {
      return stmts.insertRegistration.run({
        email_id:   data.email_id,
        proxy_id:   data.proxy_id,
        profile_id: data.profile_id ?? null,
        status:     data.status ?? 'success',
        credits:    data.credits ?? null,
      });
    },

    /**
     * Сохраняет запись об ошибке.
     * @param {{ email_id?: number, proxy_id?: number, step: string, error_message: string, error_stack?: string, screenshot_path?: string }} data
     * @returns {object}
     */
    saveErrorLog(data) {
      return stmts.insertErrorLog.run({
        email_id: data.email_id ?? null,
        proxy_id: data.proxy_id ?? null,
        step: data.step,
        error_message: data.error_message,
        error_stack: data.error_stack ?? null,
        screenshot_path: data.screenshot_path ?? null,
      });
    },

    /**
     * Возвращает все IMAP-прокси из таблицы imap_proxies.
     * @returns {Array<{ id, host, port, username, password, protocol }>}
     */
    getImapProxies() {
      return db.prepare('SELECT * FROM imap_proxies ORDER BY id ASC').all();
    },

    /**
     * Вставляет один IMAP-прокси. Пропускает дубли по host+port.
     * @param {{ host: string, port: number, username?: string, password?: string, protocol?: string }} data
     * @returns {object}
     */
    insertImapProxy(data) {
      return db.prepare(`
        INSERT OR IGNORE INTO imap_proxies (host, port, username, password, protocol)
        VALUES (@host, @port, @username, @password, @protocol)
      `).run({
        host:     data.host,
        port:     data.port,
        username: data.username || null,
        password: data.password || null,
        protocol: data.protocol || 'socks5',
      });
    },

    /**
     * Закрывает соединение с БД.
     */
    close() {
      db.close();
    },
  };
}

module.exports = { createSQLiteDatabase };
