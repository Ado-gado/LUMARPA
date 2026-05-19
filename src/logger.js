'use strict';

const fs = require('fs');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

/**
 * Создаёт winston logger с двумя транспортами:
 *  - Console (stdout, human-readable, с цветами)
 *  - DailyRotateFile (logs/%DATE%.log, без цветов, simple-формат)
 *
 * @param {string} [logLevel] - уровень логирования (error|warn|info|debug).
 *   Если не передан — читается из process.env.LOG_LEVEL, иначе 'info'.
 * @returns {winston.Logger}
 */
function createLogger(logLevel) {
  const level = logLevel || process.env.LOG_LEVEL || 'info';

  // Гарантируем существование директории logs/
  fs.mkdirSync('logs', { recursive: true });

  // Базовый формат: timestamp + level + message + stack (если есть)
  const baseFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      // Включаем stack trace если он передан в meta или прикреплён к ошибке
      const stackStr = stack || meta.stack;
      const metaStr = Object.keys(meta).length
        ? ' ' + JSON.stringify(meta)
        : '';
      return stackStr
        ? `[${timestamp}] ${level}: ${message}${metaStr}\n${stackStr}`
        : `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
  );

  // Формат для Console — с цветами
  const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      const stackStr = stack || meta.stack;
      const metaStr = Object.keys(meta).length
        ? ' ' + JSON.stringify(meta)
        : '';
      return stackStr
        ? `[${timestamp}] ${level}: ${message}${metaStr}\n${stackStr}`
        : `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
  );

  const transports = [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new DailyRotateFile({
      dirname: 'logs',
      filename: '%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      format: baseFormat,
    }),
  ];

  return winston.createLogger({
    level,
    transports,
  });
}

module.exports = { createLogger };
