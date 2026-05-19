'use strict';

const net = require('net');

/**
 * Кастомный класс ошибки для AdsPower API.
 */
class AdsPowerError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AdsPowerError';
    this.code = code;
  }
}

/**
 * Кастомный класс ошибки для недоступного прокси.
 * Воркер увидит этот тип и пометит прокси как failed.
 */
class ProxyCheckError extends Error {
  constructor(host, port, reason) {
    super(`Proxy ${host}:${port} is not reachable: ${reason}`);
    this.name = 'ProxyCheckError';
    this.host = host;
    this.port = port;
  }
}

/**
 * Проверяет доступность прокси TCP-подключением.
 * Таймаут 10 секунд.
 *
 * @param {string} host
 * @param {number} port
 * @returns {Promise<void>} — бросает ProxyCheckError если недоступен
 */
function checkProxyReachable(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: 10_000 }, () => {
      socket.destroy();
      resolve();
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new ProxyCheckError(host, port, 'connection timeout (10s)'));
    });
    socket.on('error', (err) => {
      socket.destroy();
      reject(new ProxyCheckError(host, port, err.message));
    });
  });
}

/**
 * Выполняет HTTP-запрос с таймаутом 30 секунд.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>} Распарсенный JSON-ответ
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new AdsPowerError(
        `HTTP ${response.status} ${response.statusText} for ${url}`,
        response.status
      );
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Фабричная функция для создания AdsPowerService.
 *
 * @param {{ adspowerApiUrl: string }} config
 * @param {import('winston').Logger} logger
 * @returns {{ createProfile, startProfile, stopProfile, deleteProfile }}
 */
function createAdsPowerService(config, logger) {
  const baseUrl = config.adspowerApiUrl;

  /**
   * Создаёт браузерный профиль в AdsPower с привязкой прокси.
   *
   * @param {{ protocol: string, host: string, port: string|number, username: string, password: string }} proxyData
   * @param {string} groupId
   * @returns {Promise<string>} profile_id
   */
  async function createProfile(proxyData, groupId, profileName) {
    // ── Шаг 0: проверяем TCP-доступность прокси ──────────────────────────────
    logger.info(`[AdsPower] Checking proxy ${proxyData.host}:${proxyData.port}...`);
    try {
      await checkProxyReachable(proxyData.host, Number(proxyData.port));
      logger.info(`[AdsPower] Proxy ${proxyData.host}:${proxyData.port} is reachable ✓`);
    } catch (err) {
      logger.error(`[AdsPower] Proxy check failed: ${err.message}`);
      throw err; // ProxyCheckError — воркер пометит прокси как failed
    }

    const url = `${baseUrl}/api/v1/user/create`;
    const body = {
      name:     profileName || undefined,  // имя профиля = email аккаунта
      group_id: groupId,
      user_proxy_config: {
        proxy_soft:     'other',
        proxy_type:     proxyData.protocol,
        proxy_host:     proxyData.host,
        proxy_port:     String(proxyData.port),
        proxy_user:     proxyData.username,
        proxy_password: proxyData.password,
      },
      fingerprint_config: {
        // Таймзона автоматически по IP
        automatic_timezone: '1',
        // WebRTC отключён — не светим реальный IP
        webrtc: 'disabled',
        // Язык фиксированный английский
        language_switch: '0',
        language: ['en-US', 'en'],
        // Full HD разрешение
        screen_resolution: '1920_1080',
        // Все шрифты
        fonts: ['all'],
        // Шум canvas fingerprint
        canvas: '1',
        // Шум WebGL image
        webgl_image: '1',
        // Случайный WebGL metadata
        webgl: '3',
        // Шум аудио
        audio: '1',
        // Do Not Track — дефолт
        do_not_track: 'default',
        // 4 ядра CPU
        hardware_concurrency: '4',
        // 8GB RAM
        device_memory: '8',
        // Защита от сканирования портов
        scan_port_type: '1',
        // Шум медиа устройств
        media_devices: '1',
        // Шум ClientRects
        client_rects: '1',
        // Маскировка имени устройства
        device_name_switch: '1',
        // User-Agent: Chrome 124 / Windows 10
        random_ua: {
          ua_browser:         ['chrome'],
          ua_version:         ['124'],
          ua_system_version:  ['Windows 10'],
        },
      },
    };

    logger.debug(`[AdsPower] POST ${url}`, { body });

    let response;
    try {
      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      logger.error(`[AdsPower] createProfile request failed: ${err.message}`, { err });
      throw err;
    }

    if (response.code !== 0) {
      const msg = `[AdsPower] createProfile failed: ${response.msg || JSON.stringify(response)}`;
      logger.error(msg, { response });
      throw new AdsPowerError(msg, response.code);
    }

    const profileId = response.data.id;
    logger.info(`[AdsPower] Profile created: ${profileId}`);
    return profileId;
  }

  /**
   * Запускает профиль AdsPower и возвращает CDP WebSocket URL.
   *
   * @param {string} profileId
   * @returns {Promise<string>} CDP WebSocket URL
   */
  async function startProfile(profileId, headless = true) {
    // headless=1 — браузер запускается скрыто (без окна на экране)
    const headlessParam = headless ? 1 : 0;
    const url = `${baseUrl}/api/v1/browser/start?user_id=${encodeURIComponent(profileId)}&open_tabs=0&ip_tab=0&headless=${headlessParam}`;

    logger.debug(`[AdsPower] GET ${url}`);

    let response;
    try {
      response = await fetchWithTimeout(url);
    } catch (err) {
      logger.error(`[AdsPower] startProfile request failed: ${err.message}`, { err });
      throw err;
    }

    if (response.code !== 0) {
      const msg = `[AdsPower] startProfile failed: ${response.msg || JSON.stringify(response)}`;
      logger.error(msg, { response });
      throw new AdsPowerError(msg, response.code);
    }

    const cdpUrl = response.data.ws.puppeteer;
    logger.info(`[AdsPower] Profile started: ${profileId}, CDP: ${cdpUrl}`);
    return cdpUrl;
  }

  /**
   * Останавливает профиль AdsPower. Не бросает ошибку если профиль уже остановлен.
   *
   * @param {string} profileId
   * @returns {Promise<void>}
   */
  async function stopProfile(profileId) {
    const url = `${baseUrl}/api/v1/browser/stop?user_id=${encodeURIComponent(profileId)}`;

    logger.debug(`[AdsPower] GET ${url}`);

    let response;
    try {
      response = await fetchWithTimeout(url);
    } catch (err) {
      logger.error(`[AdsPower] stopProfile request failed: ${err.message}`, { err });
      // Не пробрасываем — остановка не должна прерывать cleanup
      return;
    }

    if (response.code !== 0) {
      logger.warn(`[AdsPower] stopProfile returned non-zero code for ${profileId}: ${response.msg || JSON.stringify(response)}`, { response });
    } else {
      logger.info(`[AdsPower] Profile stopped: ${profileId}`);
    }
  }

  /**
   * Удаляет профиль AdsPower.
   *
   * @param {string} profileId
   * @returns {Promise<void>}
   */
  async function deleteProfile(profileId) {
    const url = `${baseUrl}/api/v1/user/delete`;
    const body = { user_ids: [profileId] };

    logger.debug(`[AdsPower] POST ${url}`, { body });

    let response;
    try {
      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      logger.error(`[AdsPower] deleteProfile request failed: ${err.message}`, { err });
      throw err;
    }

    if (response.code !== 0) {
      const msg = `[AdsPower] deleteProfile failed: ${response.msg || JSON.stringify(response)}`;
      logger.error(msg, { response });
      throw new AdsPowerError(msg, response.code);
    }

    logger.info(`[AdsPower] Profile deleted: ${profileId}`);
  }

  return { createProfile, startProfile, stopProfile, deleteProfile };
}

module.exports = { createAdsPowerService, AdsPowerError, ProxyCheckError };
