/**
 * logger.js — Structured JSON logging
 *
 * Outputs structured log entries with ISO timestamps, log levels,
 * and contextual data. Machine-parseable for cloud log aggregation
 * (CloudWatch, Azure Monitor) while remaining human-readable in
 * the terminal during local development.
 *
 * Log levels: debug < info < warn < error
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Default to 'info' if not set or invalid
const currentLevel =
  LOG_LEVELS[process.env.LOG_LEVEL] !== undefined
    ? process.env.LOG_LEVEL
    : 'info';

/**
 * Write a structured log entry to stdout/stderr.
 *
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message — Human-readable log message
 * @param {Object} [data] — Optional structured data to include
 */
function log(level, message, data = {}) {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  const output = JSON.stringify(entry);

  if (level === 'error') {
    console.error(output);
  } else {
    console.log(output);
  }
}

const logger = {
  debug: (message, data) => log('debug', message, data),
  info: (message, data) => log('info', message, data),
  warn: (message, data) => log('warn', message, data),
  error: (message, data) => log('error', message, data),
};

module.exports = logger;
