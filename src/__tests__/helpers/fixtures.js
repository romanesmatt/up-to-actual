/**
 * fixtures.js — Shared test fixtures and factory functions
 */

const path = require('node:path');
const SRC_DIR = path.resolve(__dirname, '..', '..');

/**
 * Create a mock Up Bank transaction with sensible defaults.
 * Override any field via the overrides parameter.
 *
 * @param {Object} overrides — Fields to override on the transaction
 * @param {Object} overrides.attributes — Fields to override on attributes
 * @returns {Object} A mock Up Bank transaction resource
 */
function makeUpTransaction(overrides = {}) {
  const { attributes: attrOverrides, ...topOverrides } = overrides;

  return {
    id: 'txn_abc123',
    attributes: {
      description: 'Woolworths',
      amount: {
        valueInBaseUnits: -5998,
        value: '-59.98',
        currencyCode: 'AUD',
      },
      createdAt: '2026-01-26T04:51:32+11:00',
      message: null,
      status: 'SETTLED',
      rawText: 'WOOLWORTHS 1234 MELBOURNE',
      settledAt: '2026-01-27T02:00:00+11:00',
      cardPurchaseMethod: { method: 'CONTACTLESS' },
      ...attrOverrides,
    },
    ...topOverrides,
  };
}

/**
 * Create a mock fetch Response object.
 *
 * @param {Object} body — JSON response body
 * @param {number} [status=200] — HTTP status code
 * @param {Object} [headers={}] — Response headers
 * @returns {Object} Mock response matching fetch Response interface
 */
function mockFetchResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `Error ${status}`,
    json: async () => body,
    headers: {
      get: (name) => headers[name] || null,
    },
  };
}

/**
 * Set the minimum required environment variables for config to load.
 * Call this before requiring any module that imports config.js.
 */
function setTestEnv(overrides = {}) {
  const defaults = {
    UP_API_TOKEN: 'up:yeah:test-token-abc123',
    ACTUAL_SERVER_URL: 'https://test.pikapods.net',
    ACTUAL_PASSWORD: 'test-password',
    ACTUAL_SYNC_ID: 'test-sync-uuid',
    ACTUAL_ACCOUNT_ID: 'test-account-uuid',
    LOG_LEVEL: 'error', // Suppress log noise in tests
  };

  Object.assign(process.env, { ...defaults, ...overrides });
}

/**
 * Clear require cache for source modules so they pick up fresh env vars.
 * Call this in beforeEach when testing modules that read config at load time.
 *
 * @param {string[]} moduleNames — Module names relative to src/ (e.g. 'config', 'logger', 'notify')
 */
function clearModuleCache(moduleNames) {
  for (const name of moduleNames) {
    const fullPath = path.join(SRC_DIR, name);
    const resolved = require.resolve(fullPath);
    delete require.cache[resolved];
  }
}

module.exports = {
  makeUpTransaction,
  mockFetchResponse,
  setTestEnv,
  clearModuleCache,
};
