'use strict';

const { createSQLiteDatabase } = require('./sqlite');

/**
 * Фабрика базы данных. Возвращает реализацию согласно config.dbType.
 * Единый интерфейс — вызывающий код не зависит от конкретной СУБД.
 *
 * @param {{ dbType: string, dbPath: string }} config
 * @returns {object}
 */
function createDatabase(config) {
  if (config.dbType === 'sqlite') {
    return createSQLiteDatabase(config.dbPath);
  }
  throw new Error(`Unsupported DB_TYPE: ${config.dbType}. Only 'sqlite' is supported in MVP.`);
}

module.exports = { createDatabase };
