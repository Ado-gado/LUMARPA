'use strict';

const fs = require('fs');

const { config } = require('./config');
const { createLogger } = require('./logger');
const { createDatabase } = require('./database');
const { createAdsPowerService } = require('./services/adspower');
const { createEmailService } = require('./services/email');
const { createCaptchaService } = require('./services/captcha');
const { createCookiesService } = require('./services/cookies');
const { createImapProxyPool } = require('./services/imap-proxy-pool');
const { runWorker } = require('./worker');

async function main() {
  // 1. Создать logger
  const logger = createLogger(config.logLevel);

  // 2. Создать необходимые директории
  fs.mkdirSync('logs',                    { recursive: true });
  fs.mkdirSync('screenshots',             { recursive: true });
  fs.mkdirSync(config.cookiesDir || './cookies', { recursive: true });

  // 3. Создать БД (миграции запустятся автоматически)
  const db = createDatabase(config);

  // 4. Создать пул IMAP-прокси (round-robin, отдельный от прокси браузера)
  let imapProxyPool;
  try {
    imapProxyPool = createImapProxyPool(db, logger);
  } catch (err) {
    logger.error(`[Main] ${err.message}`);
    logger.error('[Main] Добавьте IMAP-прокси через: node scripts/import-imap-proxies.js <file>');
    process.exit(1);
  }

  // 5. Создать сервисы
  const adsPower      = createAdsPowerService(config, logger);
  const emailService  = createEmailService(config, imapProxyPool, logger);
  const captchaService = createCaptchaService(config, logger);
  const cookiesService = createCookiesService(config, logger);

  // 6. Флаг graceful shutdown
  const stopSignal = { stopped: false };

  process.on('SIGINT', () => {
    logger.info('[Main] SIGINT received, stopping workers gracefully...');
    stopSignal.stopped = true;
  });

  process.on('SIGTERM', () => {
    logger.info('[Main] SIGTERM received, stopping workers gracefully...');
    stopSignal.stopped = true;
  });

  // 7. Функция цикла одного воркера
  async function workerLoop(workerId) {
    logger.info(`[Main] Worker ${workerId} started`);
    while (!stopSignal.stopped) {
      const result = await runWorker({
        db,
        config,
        logger,
        adsPower,
        emailService,
        captchaService,
        cookiesService,
        stopSignal,
      });
      if (
        result.status === 'no_emails' ||
        result.status === 'no_proxies' ||
        result.status === 'stopped'
      ) {
        break;
      }
      // При ошибке — продолжаем цикл (следующий email)
    }
    logger.info(`[Main] Worker ${workerId} finished`);
  }

  // 8. Запустить все воркеры параллельно
  const workers = Array.from({ length: config.concurrency }, (_, i) =>
    workerLoop(i + 1)
  );
  await Promise.all(workers);

  logger.info('[Main] All workers finished. Closing database...');
  db.close();
  logger.info('[Main] Done.');
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err.message, err.stack);
  process.exit(1);
});
