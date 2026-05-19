'use strict';

const CAPSOLVER_CREATE_TASK_URL = 'https://api.capsolver.com/createTask';
const CAPSOLVER_GET_RESULT_URL  = 'https://api.capsolver.com/getTaskResult';

const POLL_INTERVAL_MS  = 3_000;
const MAX_WAIT_MS       = 120_000;
const HTTP_TIMEOUT_MS   = 30_000;

/**
 * Кастомный класс ошибки для Capsolver.
 */
class CaptchaError extends Error {
  constructor(message, errorCode) {
    super(message);
    this.name = 'CaptchaError';
    this.errorCode = errorCode;
  }
}

/**
 * Ожидание заданного количества миллисекунд.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Выполняет POST-запрос к Capsolver с таймаутом 30 секунд.
 *
 * @param {string} url
 * @param {object} body
 * @returns {Promise<object>} Распарсенный JSON-ответ
 */
async function fetchWithTimeout(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new CaptchaError(
        `HTTP ${response.status} ${response.statusText} for ${url}`,
        `HTTP_${response.status}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Фабричная функция для создания CaptchaService.
 *
 * @param {{ capsolverApiKey: string }} config
 * @param {import('winston').Logger} logger
 * @returns {{ solveRecaptchaV2, solveRecaptchaV3, solveHCaptcha }}
 */
function createCaptchaService(config, logger) {
  const clientKey = config.capsolverApiKey;

  /**
   * Создаёт задачу в Capsolver и возвращает taskId.
   *
   * @param {object} task — объект task для тела запроса
   * @returns {Promise<string>} taskId
   */
  async function createTask(task) {
    const body = { clientKey, task };

    logger.debug('[Capsolver] Creating task', { type: task.type });

    let data;
    try {
      data = await fetchWithTimeout(CAPSOLVER_CREATE_TASK_URL, body);
    } catch (err) {
      logger.error(`[Capsolver] createTask request failed: ${err.message}`, { err });
      throw err instanceof CaptchaError
        ? err
        : new CaptchaError(`createTask request failed: ${err.message}`, 'REQUEST_FAILED');
    }

    if (data.errorId && data.errorId !== 0) {
      const msg = `[Capsolver] createTask error: ${data.errorCode || data.errorId} — ${data.errorDescription || ''}`;
      logger.error(msg, { data });
      throw new CaptchaError(msg, data.errorCode || String(data.errorId));
    }

    const taskId = data.taskId;
    logger.info(`[Capsolver] Task created: ${taskId}`, { type: task.type });
    return taskId;
  }

  /**
   * Polling getTaskResult до получения статуса "ready" или таймаута.
   *
   * @param {string} taskId
   * @returns {Promise<object>} solution объект из ответа Capsolver
   */
  async function pollResult(taskId) {
    const deadline = Date.now() + MAX_WAIT_MS;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt += 1;
      logger.debug(`[Capsolver] Polling taskId=${taskId}, attempt=${attempt}`);

      let data;
      try {
        data = await fetchWithTimeout(CAPSOLVER_GET_RESULT_URL, { clientKey, taskId });
      } catch (err) {
        logger.error(`[Capsolver] getTaskResult request failed: ${err.message}`, { taskId, err });
        throw err instanceof CaptchaError
          ? err
          : new CaptchaError(`getTaskResult request failed: ${err.message}`, 'REQUEST_FAILED');
      }

      if (data.errorId && data.errorId !== 0) {
        const msg = `[Capsolver] getTaskResult error: ${data.errorCode || data.errorId} — ${data.errorDescription || ''}`;
        logger.error(msg, { taskId, data });
        throw new CaptchaError(msg, data.errorCode || String(data.errorId));
      }

      if (data.status === 'ready') {
        logger.info(`[Capsolver] Task solved: ${taskId}`, { attempt });
        return data.solution;
      }

      // status === 'processing' или другой промежуточный — ждём
      await sleep(POLL_INTERVAL_MS);
    }

    const msg = `[Capsolver] Timeout waiting for taskId=${taskId} after ${MAX_WAIT_MS}ms`;
    logger.error(msg, { taskId });
    throw new CaptchaError(msg, 'TIMEOUT');
  }

  /**
   * Решает reCAPTCHA v2 (proxyless).
   *
   * @param {string} siteKey
   * @param {string} pageUrl
   * @returns {Promise<string>} gRecaptchaResponse токен
   */
  async function solveRecaptchaV2(siteKey, pageUrl) {
    const task = {
      type: 'ReCaptchaV2TaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };

    const taskId  = await createTask(task);
    const solution = await pollResult(taskId);
    return solution.gRecaptchaResponse;
  }

  /**
   * Решает reCAPTCHA v3 (proxyless).
   *
   * @param {string} siteKey
   * @param {string} pageUrl
   * @param {string} action
   * @returns {Promise<string>} gRecaptchaResponse токен
   */
  async function solveRecaptchaV3(siteKey, pageUrl, action) {
    const task = {
      type: 'ReCaptchaV3TaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
      pageAction: action,
    };

    const taskId   = await createTask(task);
    const solution = await pollResult(taskId);
    return solution.gRecaptchaResponse;
  }

  /**
   * Решает hCaptcha (proxyless).
   *
   * @param {string} siteKey
   * @param {string} pageUrl
   * @returns {Promise<string>} gRecaptchaResponse токен
   */
  async function solveHCaptcha(siteKey, pageUrl) {
    const task = {
      type: 'HCaptchaTaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };

    const taskId   = await createTask(task);
    const solution = await pollResult(taskId);
    return solution.gRecaptchaResponse;
  }

  return { solveRecaptchaV2, solveRecaptchaV3, solveHCaptcha };
}

module.exports = { createCaptchaService, CaptchaError };
