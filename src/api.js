'use strict';

/**
 * REST API сервер для управления автоматизацией регистрации.
 * Оборачивает существующую SQLite БД и процесс воркера.
 * НЕ модифицирует существующий код src/worker.js, src/index.js, src/services/.
 *
 * Запуск: node src/api.js
 * Порт:  3001 (можно переопределить через API_PORT)
 */

const path     = require('path');
const fs       = require('fs');
const express  = require('express');
const cors     = require('cors');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

// Корень проекта — на 1 уровень выше src/
const ROOT_DIR    = path.resolve(__dirname, '..');
const DB_PATH     = process.env.DB_PATH    || path.join(ROOT_DIR, 'data', 'accounts.db');
const LOGS_DIR    = process.env.LOGS_DIR   || path.join(ROOT_DIR, 'logs');
const ENV_PATH    = process.env.ENV_PATH   || path.join(ROOT_DIR, '.env');
const UI_DIST     = path.join(__dirname, 'ui', 'dist');
const PORT        = parseInt(process.env.API_PORT, 10) || 3001;

// ─── База данных ────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Гарантируем минимум таблиц (на случай первого запуска через UI до бэка)
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
    credits TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Парсинг файлов прокси/email из текста ──────────────────────────────────
function parseEmailLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes(':'))
    .map(l => {
      const idx = l.indexOf(':');
      return { email: l.slice(0, idx).trim(), password: l.slice(idx + 1).trim() };
    })
    .filter(a => a.email && a.password);
}

function parseProxyLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      // Формат: socks5://user:pass@host:port
      if (l.includes('://')) {
        try {
          const u = new URL(l);
          return {
            protocol: u.protocol.replace(':', '') || 'socks5',
            host:     u.hostname,
            port:     parseInt(u.port, 10) || 1080,
            username: u.username ? decodeURIComponent(u.username) : null,
            password: u.password ? decodeURIComponent(u.password) : null,
          };
        } catch { return null; }
      }
      // Формат: user:pass@host:port
      if (l.includes('@')) {
        const atIdx = l.lastIndexOf('@');
        const credentials = l.slice(0, atIdx);
        const hostPort    = l.slice(atIdx + 1);
        const colonIdx    = credentials.indexOf(':');
        const username    = colonIdx >= 0 ? credentials.slice(0, colonIdx) : credentials;
        const password    = colonIdx >= 0 ? credentials.slice(colonIdx + 1) : null;
        const parts       = hostPort.split(':');
        const host        = parts[0];
        const port        = parseInt(parts[1], 10);
        if (!host || !port) return null;
        return { protocol: 'socks5', host, port, username, password };
      }
      // Формат: host:port[:user[:pass]]
      const p = l.split(':');
      if (p.length < 2) return null;
      const port = parseInt(p[1], 10);
      if (!port) return null;
      return {
        protocol: 'socks5',
        host:     p[0],
        port,
        username: p[2] || null,
        password: p[3] || null,
      };
    })
    .filter(Boolean);
}

// ─── .env чтение/запись ─────────────────────────────────────────────────────
function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    const k = t.slice(0, idx).trim();
    let v = t.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function writeEnvFile(updates) {
  const current = readEnvFile();
  const merged  = { ...current, ...updates };
  const order = [
    'TARGET_URL', 'ADSPOWER_API_URL', 'ADSPOWER_GROUP_ID', 'CAPSOLVER_API_KEY',
    'MAX_RETRIES', 'EMAIL_TIMEOUT_MS', 'PLAYWRIGHT_TIMEOUT_MS',
    'PROXY_PROTOCOL', 'CONCURRENCY', 'HEADLESS',
    'DB_TYPE', 'DB_PATH', 'LOG_LEVEL',
    'CODE_REGEX', 'EMAIL_SENDER_PATTERN', 'COOKIES_DIR',
  ];
  const seen  = new Set();
  const lines = [];
  for (const k of order) {
    if (merged[k] !== undefined && merged[k] !== null) {
      lines.push(`${k}=${merged[k]}`);
      seen.add(k);
    }
  }
  for (const [k, v] of Object.entries(merged)) {
    if (!seen.has(k) && v !== undefined && v !== null) {
      lines.push(`${k}=${v}`);
    }
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

// ─── Управление воркером ────────────────────────────────────────────────────
const workerState = {
  proc: null,
  startedAt: null,
  status: 'stopped',    // 'stopped' | 'running' | 'error'
  lastError: null,
  lastExitCode: null,
};

function isWorkerRunning() {
  return !!workerState.proc && !workerState.proc.killed;
}

function startWorker({ count, concurrency, headless }) {
  if (isWorkerRunning()) {
    return { ok: false, error: 'Worker already running' };
  }
  const env = { ...process.env };
  if (concurrency !== undefined && concurrency !== null && concurrency !== '') {
    env.CONCURRENCY = String(concurrency);
  }
  if (headless !== undefined && headless !== null) {
    env.HEADLESS = headless ? 'true' : 'false';
  }
  if (count !== undefined && count !== null && count !== '') {
    env.REGISTER_COUNT = String(count);   // воркер может это игнорировать — не страшно
  }

  const indexJs = path.join(__dirname, 'index.js');
  if (!fs.existsSync(indexJs)) {
    workerState.status    = 'error';
    workerState.lastError = `src/index.js not found at ${indexJs}`;
    return { ok: false, error: workerState.lastError };
  }

  const proc = spawn(process.execPath, [indexJs], {
    cwd: ROOT_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  workerState.proc         = proc;
  workerState.startedAt    = new Date().toISOString();
  workerState.status       = 'running';
  workerState.lastError    = null;
  workerState.lastExitCode = null;

  proc.stdout.on('data', (chunk) => process.stdout.write(chunk));
  proc.stderr.on('data', (chunk) => process.stderr.write(chunk));

  proc.on('exit', (code, signal) => {
    workerState.lastExitCode = code;
    workerState.proc         = null;
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      workerState.status = 'stopped';
    } else {
      workerState.status    = 'error';
      workerState.lastError = `Worker exited with code ${code}${signal ? ' (signal ' + signal + ')' : ''}`;
    }
  });

  proc.on('error', (err) => {
    workerState.status    = 'error';
    workerState.lastError = err.message;
    workerState.proc      = null;
  });

  return { ok: true, pid: proc.pid };
}

function stopWorker() {
  if (!isWorkerRunning()) {
    return { ok: false, error: 'Worker not running' };
  }
  try {
    workerState.proc.kill('SIGTERM');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Express ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ─── /api/stats ─────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  try {
    const r = (sql) => db.prepare(sql).get().c;
    res.json({
      emailsAvailable:  r(`SELECT COUNT(*) c FROM emails  WHERE status='available'`),
      emailsInProgress: r(`SELECT COUNT(*) c FROM emails  WHERE status='in_progress'`),
      emailsRegistered: r(`SELECT COUNT(*) c FROM emails  WHERE status='registered'`),
      emailsFailed:     r(`SELECT COUNT(*) c FROM emails  WHERE status='failed'`),
      emailsTotal:      r(`SELECT COUNT(*) c FROM emails`),
      proxiesAvailable: r(`SELECT COUNT(*) c FROM proxies WHERE status='available'`),
      proxiesInUse:     r(`SELECT COUNT(*) c FROM proxies WHERE status='in_use'`),
      proxiesUsed:      r(`SELECT COUNT(*) c FROM proxies WHERE status='used'`),
      proxiesFailed:    r(`SELECT COUNT(*) c FROM proxies WHERE status='failed'`),
      imapProxiesTotal: r(`SELECT COUNT(*) c FROM imap_proxies`),
      registrationsTotal: r(`SELECT COUNT(*) c FROM registrations WHERE status='success'`),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/emails ────────────────────────────────────────────────────────────
app.get('/api/emails', (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const status = req.query.status;
  try {
    const where  = status ? `WHERE status = ?` : '';
    const params = status ? [status] : [];
    const total = db.prepare(`SELECT COUNT(*) c FROM emails ${where}`).get(...params).c;
    const rows  = db.prepare(
      `SELECT id, email, password, status, attempts, created_at, updated_at
       FROM emails ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    res.json({ rows, total, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/emails/import', (req, res) => {
  try {
    const items = parseEmailLines(req.body && req.body.text);
    if (items.length === 0) return res.status(400).json({ error: 'Не найдено валидных строк (формат: email:password)' });
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO emails (email, password, status, attempts) VALUES (@email, @password, 'available', 0)`
    );
    let added = 0;
    db.transaction(() => {
      for (const a of items) if (stmt.run(a).changes > 0) added++;
    })();
    res.json({ ok: true, added, skipped: items.length - added, total: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/emails/reset-failed', (req, res) => {
  try {
    const r = db.prepare(
      `UPDATE emails SET status='available', attempts=0, updated_at=datetime('now') WHERE status='failed'`
    ).run();
    res.json({ ok: true, changed: r.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/emails/export-registered', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT e.email, e.password FROM registrations r
       JOIN emails e ON e.id = r.email_id
       WHERE r.status='success' ORDER BY r.created_at ASC`
    ).all();
    const body = rows.map(r => `${r.email}:${r.password}`).join('\n') + '\n';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="registered.txt"');
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/proxies ───────────────────────────────────────────────────────────
app.get('/api/proxies', (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  try {
    const total = db.prepare(`SELECT COUNT(*) c FROM proxies`).get().c;
    const rows  = db.prepare(
      `SELECT id, host, port, username, protocol, status, created_at
       FROM proxies ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
    res.json({ rows, total, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/proxies/import', (req, res) => {
  try {
    const items = parseProxyLines(req.body && req.body.text);
    if (items.length === 0) return res.status(400).json({ error: 'Не найдено валидных прокси' });
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO proxies (host, port, username, password, protocol, status)
       VALUES (@host, @port, @username, @password, @protocol, 'available')`
    );
    let added = 0;
    db.transaction(() => {
      for (const p of items) if (stmt.run(p).changes > 0) added++;
    })();
    res.json({ ok: true, added, skipped: items.length - added, total: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/proxies/reset-failed', (req, res) => {
  try {
    const r = db.prepare(
      `UPDATE proxies SET status='available', updated_at=datetime('now') WHERE status='failed'`
    ).run();
    res.json({ ok: true, changed: r.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/proxies/clear-used', (req, res) => {
  try {
    const r = db.prepare(`DELETE FROM proxies WHERE status='used'`).run();
    res.json({ ok: true, deleted: r.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/imap-proxies ──────────────────────────────────────────────────────
app.get('/api/imap-proxies', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT id, host, port, username, protocol, created_at FROM imap_proxies ORDER BY id ASC`
    ).all();
    res.json({ rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/imap-proxies/import', (req, res) => {
  try {
    const items = parseProxyLines(req.body && req.body.text);
    if (items.length === 0) return res.status(400).json({ error: 'Не найдено валидных прокси' });
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO imap_proxies (host, port, username, password, protocol)
       VALUES (@host, @port, @username, @password, @protocol)`
    );
    let added = 0;
    db.transaction(() => {
      for (const p of items) if (stmt.run(p).changes > 0) added++;
    })();
    res.json({ ok: true, added, skipped: items.length - added, total: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/imap-proxies/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = db.prepare(`DELETE FROM imap_proxies WHERE id = ?`).run(id);
    res.json({ ok: true, deleted: r.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/logs ──────────────────────────────────────────────────────────────
function todayLogPath() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `${yyyy}-${mm}-${dd}.log`);
}

app.get('/api/logs', (req, res) => {
  try {
    const lines = Math.min(2000, Math.max(1, parseInt(req.query.lines, 10) || 200));
    const file = todayLogPath();
    if (!fs.existsSync(file)) return res.json({ lines: [], file });
    const content = fs.readFileSync(file, 'utf8');
    const all = content.split(/\r?\n/).filter(Boolean);
    res.json({ lines: all.slice(-lines), file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE стрим: чтение хвоста файла лога каждые 1.5 сек
app.get('/api/logs/stream', (req, res) => {
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let lastSize = 0;
  let closed   = false;

  const file = todayLogPath();
  if (fs.existsSync(file)) {
    lastSize = fs.statSync(file).size;
  }

  const tick = () => {
    if (closed) return;
    try {
      const f = todayLogPath();
      if (fs.existsSync(f)) {
        const stat = fs.statSync(f);
        if (stat.size > lastSize) {
          const stream = fs.createReadStream(f, { start: lastSize, end: stat.size });
          let buf = '';
          stream.on('data', (chunk) => { buf += chunk.toString('utf8'); });
          stream.on('end', () => {
            for (const line of buf.split(/\r?\n/)) {
              if (line) res.write(`data: ${line}\n\n`);
            }
            lastSize = stat.size;
          });
        } else if (stat.size < lastSize) {
          // лог перезаписался или ротация
          lastSize = 0;
        }
      }
    } catch { /* ignore */ }
  };

  const iv = setInterval(tick, 1500);
  const hb = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    closed = true;
    clearInterval(iv);
    clearInterval(hb);
  });
});

// ─── /api/status, /api/start, /api/stop ─────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    running:      isWorkerRunning(),
    status:       workerState.status,
    pid:          workerState.proc ? workerState.proc.pid : null,
    startedAt:    workerState.startedAt,
    lastError:    workerState.lastError,
    lastExitCode: workerState.lastExitCode,
  });
});

app.post('/api/start', (req, res) => {
  const body = req.body || {};
  const result = startWorker({
    count:       body.count,
    concurrency: body.concurrency,
    headless:    body.headless,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true, pid: result.pid });
});

app.post('/api/stop', (req, res) => {
  const result = stopWorker();
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

// ─── /api/settings ──────────────────────────────────────────────────────────
const SETTINGS_KEYS = [
  'TARGET_URL', 'ADSPOWER_API_URL', 'ADSPOWER_GROUP_ID', 'CAPSOLVER_API_KEY',
  'MAX_RETRIES', 'EMAIL_TIMEOUT_MS', 'PLAYWRIGHT_TIMEOUT_MS',
  'CONCURRENCY', 'HEADLESS', 'PROXY_PROTOCOL',
  'CODE_REGEX', 'EMAIL_SENDER_PATTERN', 'COOKIES_DIR',
  'DB_PATH', 'LOG_LEVEL',
];

app.get('/api/settings', (req, res) => {
  try {
    const env = readEnvFile();
    const out = {};
    for (const k of SETTINGS_KEYS) out[k] = env[k] !== undefined ? env[k] : '';
    out.LOGS_DIR  = LOGS_DIR;
    out.ENV_PATH  = ENV_PATH;
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    for (const k of SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        updates[k] = String(body[k]);
      }
    }
    writeEnvFile(updates);
    res.json({ ok: true, saved: Object.keys(updates) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, db: DB_PATH, logs: LOGS_DIR }));

// ─── Static UI (production / Electron) ──────────────────────────────────────
if (fs.existsSync(UI_DIST)) {
  app.use(express.static(UI_DIST));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(UI_DIST, 'index.html'));
  });
}

// ─── Запуск ─────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[API] listening on http://127.0.0.1:${PORT}`);
  console.log(`[API] db:   ${DB_PATH}`);
  console.log(`[API] logs: ${LOGS_DIR}`);
  console.log(`[API] env:  ${ENV_PATH}`);
});

// Graceful shutdown
function shutdown() {
  if (workerState.proc) {
    try { workerState.proc.kill('SIGTERM'); } catch {}
  }
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server };
