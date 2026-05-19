'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Фабричная функция для создания сервиса экспорта cookies.
 *
 * @param {object} config — объект конфигурации (config.cookiesDir)
 * @param {import('winston').Logger} logger
 * @returns {{ exportCookies: (page: import('playwright').Page, emailAddress: string) => Promise<string> }}
 */
function createCookiesService(config, logger) {
  const cookiesDir = (config && config.cookiesDir) ? config.cookiesDir : './cookies';

  /**
   * Сохраняет cookies текущего браузерного контекста в файл.
   *
   * @param {import('playwright').Page} page - Playwright page object
   * @param {string} emailAddress - адрес email, используется как имя файла
   * @returns {Promise<string>} путь к сохранённому файлу
   */
  async function exportCookies(page, emailAddress) {
    const cookies = await page.context().cookies();

    fs.mkdirSync(cookiesDir, { recursive: true });

    const filePath = path.join(cookiesDir, `${emailAddress}.json`);
    fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), 'utf8');

    logger.info(`[Cookies] Saved ${cookies.length} cookies for ${emailAddress} → ${filePath}`);
    return filePath;
  }

  return { exportCookies };
}

module.exports = { createCookiesService };
