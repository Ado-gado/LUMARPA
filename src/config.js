'use strict';

require('dotenv').config();

// Обязательные параметры конфигурации
const REQUIRED_KEYS = [
  'TARGET_URL',
  'CAPSOLVER_API_KEY',
  'ADSPOWER_GROUP_ID',
];

// Проверка наличия обязательных параметров
for (const key of REQUIRED_KEYS) {
  if (!process.env[key]) {
    console.error(`[CONFIG ERROR] Missing required env variable: ${key}`);
    process.exit(1);
  }
}

const config = {
  targetUrl:             process.env.TARGET_URL,
  maxRetries:            parseInt(process.env.MAX_RETRIES) || 3,
  emailTimeoutMs:        parseInt(process.env.EMAIL_TIMEOUT_MS) || 90000,
  playwrightTimeoutMs:   parseInt(process.env.PLAYWRIGHT_TIMEOUT_MS) || 30000,
  capsolverApiKey:       process.env.CAPSOLVER_API_KEY,
  adspowerApiUrl:        process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325',
  adspowerGroupId:       process.env.ADSPOWER_GROUP_ID,
  proxyProtocol:         process.env.PROXY_PROTOCOL || 'socks5',
  concurrency:           parseInt(process.env.CONCURRENCY) || 1,
  headless:              process.env.HEADLESS !== 'false',
  dbType:                process.env.DB_TYPE || 'sqlite',
  dbPath:                process.env.DB_PATH || './data/accounts.db',
  logLevel:              process.env.LOG_LEVEL || 'info',
  codeRegex:             process.env.CODE_REGEX || '\\d{4,8}',
  emailSenderPattern:    process.env.EMAIL_SENDER_PATTERN || 'lumalabs.ai',
  cookiesDir:            process.env.COOKIES_DIR || './cookies',
};

module.exports = { config };
