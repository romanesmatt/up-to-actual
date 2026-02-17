/**
 * config.js — Centralised configuration and secret loading
 *
 * All secrets are loaded from environment variables (.env locally,
 * cloud secret managers in production). This module validates that
 * required variables are present and provides typed defaults for
 * optional configuration.
 *
 * SECURITY: Never log or expose the values loaded here.
 */

require('dotenv').config();

const REQUIRED_VARS = [
  'UP_API_TOKEN',
  'ACTUAL_SERVER_URL',
  'ACTUAL_PASSWORD',
  'ACTUAL_SYNC_ID',
  'ACTUAL_ACCOUNT_ID',
];

/**
 * Validate that all required environment variables are set.
 * Exits the process with a clear error message if any are missing.
 * Intentionally does NOT log the variable values.
 */
function validateConfig() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('ERROR: Missing required environment variables:');
    missing.forEach((key) => console.error(`  - ${key}`));
    console.error('\nCopy .env.example to .env and fill in your values.');
    process.exit(1);
  }
}

/**
 * Frozen configuration object.
 * Calling validateConfig() before accessing this is recommended.
 */
const config = Object.freeze({
  // Up Bank
  up: {
    apiToken: process.env.UP_API_TOKEN,
    baseUrl: 'https://api.up.com.au/api/v1',
  },

  // Actual Budget
  actual: {
    serverUrl: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
    syncId: process.env.ACTUAL_SYNC_ID,
    accountId: process.env.ACTUAL_ACCOUNT_ID,
    e2ePassword: process.env.ACTUAL_E2E_PASSWORD || null,
    dataDir: process.env.ACTUAL_DATA_DIR || './actual-data',
  },

  // Notifications
  webhookUrl: process.env.WEBHOOK_URL || null,

  // Sync settings
  sync: {
    windowHours: parseInt(process.env.SYNC_WINDOW_HOURS, 10) || 48,
    maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 4,
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
});

module.exports = { config, validateConfig };
