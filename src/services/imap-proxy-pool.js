'use strict';

/**
 * Round-robin пул прокси для IMAP-подключений.
 * Прокси хранятся в памяти, индекс ротируется атомарно.
 *
 * Формат прокси в пуле:
 *   { host, port, username, password, protocol }
 *
 * Поддерживаемые протоколы: socks5, http
 */

class ImapProxyPool {
  /**
   * @param {Array<{ host: string, port: number, username?: string, password?: string, protocol?: string }>} proxies
   * @param {import('winston').Logger} logger
   */
  constructor(proxies, logger) {
    if (!proxies || proxies.length === 0) {
      throw new Error('[ImapProxyPool] Пул прокси пуст — передайте хотя бы один прокси');
    }
    this._proxies = proxies;
    this._index = 0;
    this._logger = logger;
    logger.info(`[ImapProxyPool] Инициализирован с ${proxies.length} прокси`);
  }

  /**
   * Возвращает следующий прокси по round-robin.
   * @returns {{ host: string, port: number, username?: string, password?: string, protocol: string }}
   */
  next() {
    const proxy = this._proxies[this._index % this._proxies.length];
    this._index = (this._index + 1) % this._proxies.length;
    this._logger.debug(`[ImapProxyPool] Выдан прокси: ${proxy.host}:${proxy.port} (index=${this._index})`);
    return proxy;
  }

  /**
   * Количество прокси в пуле.
   * @returns {number}
   */
  get size() {
    return this._proxies.length;
  }
}

/**
 * Загружает IMAP-прокси из БД и создаёт пул.
 *
 * @param {object} db — объект базы данных (createSQLiteDatabase)
 * @param {import('winston').Logger} logger
 * @returns {ImapProxyPool}
 */
function createImapProxyPool(db, logger) {
  const proxies = db.getImapProxies();
  if (!proxies || proxies.length === 0) {
    throw new Error(
      '[ImapProxyPool] В таблице imap_proxies нет записей. ' +
      'Добавьте прокси через scripts/import-imap-proxies.js'
    );
  }
  return new ImapProxyPool(proxies, logger);
}

module.exports = { ImapProxyPool, createImapProxyPool };
