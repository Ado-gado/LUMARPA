'use strict';

/**
 * EmailService — получение кода подтверждения из GMX почты через IMAP.
 *
 * Каждое подключение к IMAP идёт через отдельный прокси из round-robin пула.
 * Поддерживаемые протоколы прокси: socks5, http.
 *
 * GMX IMAP: imap.gmx.com:993 (SSL)
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { SocksClient } = require('socks');
const net = require('net');

// ─── Константы ────────────────────────────────────────────────────────────────
const GMX_IMAP_HOST = 'imap.gmx.com';
const GMX_IMAP_PORT = 993;
const POLL_INTERVAL_MS = 5_000;
const IMAP_FOLDERS = ['INBOX', 'Junk'];

// ─── Ошибки ───────────────────────────────────────────────────────────────────
class EmailTimeoutError extends Error {
  constructor(email, timeoutMs) {
    super(`Timeout waiting for confirmation code for ${email} (${timeoutMs}ms)`);
    this.name = 'EmailTimeoutError';
  }
}

class EmailParseError extends Error {
  constructor(email) {
    super(`Could not extract confirmation code from email for ${email}`);
    this.name = 'EmailParseError';
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Создание TCP-сокета через прокси ─────────────────────────────────────────

/**
 * Создаёт TCP-сокет к целевому хосту через socks5-прокси.
 * Возвращает net.Socket совместимый объект.
 *
 * @param {{ host: string, port: number, username?: string, password?: string }} proxy
 * @param {string} targetHost
 * @param {number} targetPort
 * @returns {Promise<net.Socket>}
 */
async function createSocks5Socket(proxy, targetHost, targetPort) {
  const { socket } = await SocksClient.createConnection({
    proxy: {
      host:    proxy.host,
      port:    proxy.port,
      type:    5,
      userId:  proxy.username || undefined,
      password: proxy.password || undefined,
    },
    command: 'connect',
    destination: {
      host: targetHost,
      port: targetPort,
    },
  });
  return socket;
}

/**
 * Создаёт TCP-сокет к целевому хосту через http CONNECT прокси.
 *
 * @param {{ host: string, port: number, username?: string, password?: string }} proxy
 * @param {string} targetHost
 * @param {number} targetPort
 * @returns {Promise<net.Socket>}
 */
function createHttpProxySocket(proxy, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host, () => {
      let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (proxy.username && proxy.password) {
        const creds = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
        connectReq += `Proxy-Authorization: Basic ${creds}\r\n`;
      }
      connectReq += '\r\n';
      socket.write(connectReq);
    });

    let response = '';
    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (response.includes('\r\n\r\n')) {
        if (response.startsWith('HTTP/1.1 200') || response.startsWith('HTTP/1.0 200')) {
          socket.removeAllListeners('data');
          resolve(socket);
        } else {
          socket.destroy();
          reject(new Error(`HTTP proxy CONNECT failed: ${response.split('\r\n')[0]}`));
        }
      }
    });

    socket.on('error', reject);
    socket.setTimeout(15_000, () => {
      socket.destroy();
      reject(new Error('HTTP proxy CONNECT timeout'));
    });
  });
}

/**
 * Создаёт сокет через прокси в зависимости от протокола.
 *
 * @param {{ host: string, port: number, username?: string, password?: string, protocol: string }} proxy
 * @param {string} targetHost
 * @param {number} targetPort
 * @returns {Promise<net.Socket>}
 */
async function createProxySocket(proxy, targetHost, targetPort) {
  const protocol = (proxy.protocol || 'socks5').toLowerCase();
  if (protocol === 'socks5') {
    return createSocks5Socket(proxy, targetHost, targetPort);
  } else if (protocol === 'http' || protocol === 'https') {
    return createHttpProxySocket(proxy, targetHost, targetPort);
  }
  throw new Error(`Unsupported proxy protocol: ${protocol}`);
}

// ─── Чтение кода из IMAP ──────────────────────────────────────────────────────

/**
 * Подключается к GMX IMAP через прокси и ищет код подтверждения.
 *
 * @param {string} email
 * @param {string} password
 * @param {{ host: string, port: number, username?: string, password?: string, protocol: string }} proxy
 * @param {string} codeRegex — регулярное выражение для извлечения кода
 * @param {string} senderPattern — фильтр по отправителю (домен)
 * @returns {Promise<string|null>}
 */
async function fetchCodeViaImap(email, password, proxy, codeRegex, senderPattern, afterTimestamp) {
  const socket = await createProxySocket(proxy, GMX_IMAP_HOST, GMX_IMAP_PORT);

  const client = new ImapFlow({
    host:   GMX_IMAP_HOST,
    port:   GMX_IMAP_PORT,
    secure: true,
    auth:   { user: email, pass: password },
    logger: false,
    tls:    { rejectUnauthorized: false },
    socketTimeout: 15_000,
    socket,
  });

  client.on('error', () => {});

  const regex = new RegExp(codeRegex);

  try {
    await client.connect();

    for (const folder of IMAP_FOLDERS) {
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const total = client.mailbox.exists;
          if (total === 0) continue;

          const from = Math.max(1, total - 9); // последние 10 писем
          for await (const msg of client.fetch(`${from}:*`, { source: true })) {
            const parsed = await simpleParser(msg.source);
            const sender = parsed.from?.value?.[0]?.address || '';

            // Фильтр по отправителю — только lumalabs.ai
            if (!sender.includes(senderPattern)) continue;

            // Фильтр по времени — только письма после начала регистрации
            if (afterTimestamp && parsed.date) {
              const emailTime = new Date(parsed.date).getTime();
              if (emailTime < afterTimestamp) continue;
            }

            const text = (parsed.text || '') + ' ' + (parsed.subject || '');
            const match = text.match(regex);
            if (match) return match[1] || match[0];
          }
        } finally {
          lock.release();
        }
      } catch {
        // Папка не найдена — пропускаем
      }
    }
  } finally {
    try { await client.logout(); } catch {}
  }

  return null;
}

// ─── Фабрика сервиса ──────────────────────────────────────────────────────────

/**
 * Создаёт EmailService для GMX с round-robin прокси.
 *
 * @param {object} config
 * @param {string} [config.codeRegex]          — regex для кода (по умолчанию \d{4,8})
 * @param {string} [config.emailSenderPattern] — фильтр по домену отправителя
 * @param {import('../services/imap-proxy-pool').ImapProxyPool} imapProxyPool
 * @param {import('winston').Logger} logger
 * @returns {{ waitForConfirmationCode: (email: string, password: string, timeoutMs: number) => Promise<string> }}
 */
function createEmailService(config, imapProxyPool, logger) {
  const codeRegex     = config.codeRegex || '\\d{4,8}';
  // Фильтр по отправителю — по умолчанию только lumalabs.ai
  const senderPattern = config.emailSenderPattern || 'lumalabs.ai';

  /**
   * Ожидает письмо с кодом подтверждения, опрашивая IMAP каждые 5 секунд.
   * Берёт только письма от senderPattern, пришедшие после startTime.
   *
   * @param {string} emailAddress
   * @param {string} emailPassword
   * @param {number} timeoutMs
   * @param {number} [startTime] — timestamp начала ожидания (мс), по умолчанию Date.now()
   * @returns {Promise<string>}
   */
  async function waitForConfirmationCode(emailAddress, emailPassword, timeoutMs, startTime) {
    const afterTimestamp = startTime || Date.now();
    const deadline = afterTimestamp + timeoutMs;
    let attempt = 0;

    while (true) {
      attempt++;
      const proxy = imapProxyPool.next();
      logger.info(
        `[Email] Попытка ${attempt} для ${emailAddress} через прокси ${proxy.host}:${proxy.port}`
      );

      try {
        const code = await fetchCodeViaImap(
          emailAddress,
          emailPassword,
          proxy,
          codeRegex,
          senderPattern,
          afterTimestamp
        );
        if (code) {
          logger.info(`[Email] Код найден для ${emailAddress}: ${code}`);
          return code;
        }
        logger.debug(`[Email] Код не найден на попытке ${attempt} для ${emailAddress}`);
      } catch (err) {
        logger.warn(
          `[Email] Ошибка на попытке ${attempt} для ${emailAddress} ` +
          `(прокси ${proxy.host}:${proxy.port}): ${err.message}`
        );
        // При ошибке IMAP — короткая пауза перед следующей попыткой
        await sleep(2000);
      }

      if (Date.now() >= deadline) {
        throw new EmailTimeoutError(emailAddress, timeoutMs);
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }

  return { waitForConfirmationCode };
}

module.exports = {
  createEmailService,
  EmailTimeoutError,
  EmailParseError,
};
