const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { clearModuleCache } = require('./helpers/fixtures');

/**
 * Replace dotenv in the require cache with a no-op so that
 * re-requiring config.js doesn't reload values from the real .env file.
 */
function stubDotenv() {
  const dotenvPath = require.resolve('dotenv');
  require.cache[dotenvPath] = {
    id: dotenvPath,
    filename: dotenvPath,
    loaded: true,
    exports: { config: () => {} },
  };
}

describe('validateConfig', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    stubDotenv();
    // Set all required vars
    process.env.UP_API_TOKEN = 'up:yeah:test-token';
    process.env.ACTUAL_SERVER_URL = 'https://test.pikapods.net';
    process.env.ACTUAL_PASSWORD = 'test-password';
    process.env.ACTUAL_SYNC_ID = 'test-sync-uuid';
    process.env.ACTUAL_ACCOUNT_ID = 'test-account-uuid';
    process.env.LOG_LEVEL = 'error';
    clearModuleCache(['config']);
  });

  afterEach(() => {
    process.env = originalEnv;
    // Restore real dotenv
    delete require.cache[require.resolve('dotenv')];
  });

  it('does not throw when all required vars are present', () => {
    const { validateConfig } = require('../config');
    assert.doesNotThrow(() => validateConfig());
  });

  it('throws when UP_API_TOKEN is missing', () => {
    delete process.env.UP_API_TOKEN;
    clearModuleCache(['config']);
    const { validateConfig } = require('../config');
    assert.throws(() => validateConfig(), {
      message: /UP_API_TOKEN/,
    });
  });

  it('throws when ACTUAL_SERVER_URL is missing', () => {
    delete process.env.ACTUAL_SERVER_URL;
    clearModuleCache(['config']);
    const { validateConfig } = require('../config');
    assert.throws(() => validateConfig(), {
      message: /ACTUAL_SERVER_URL/,
    });
  });

  it('throws when multiple vars are missing', () => {
    delete process.env.UP_API_TOKEN;
    delete process.env.ACTUAL_PASSWORD;
    delete process.env.ACTUAL_SYNC_ID;
    clearModuleCache(['config']);
    const { validateConfig } = require('../config');
    assert.throws(() => validateConfig(), (err) => {
      assert.ok(err.message.includes('UP_API_TOKEN'));
      assert.ok(err.message.includes('ACTUAL_PASSWORD'));
      assert.ok(err.message.includes('ACTUAL_SYNC_ID'));
      return true;
    });
  });
});

describe('config object', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    stubDotenv();
    process.env.UP_API_TOKEN = 'up:yeah:test-token';
    process.env.ACTUAL_SERVER_URL = 'https://test.pikapods.net';
    process.env.ACTUAL_PASSWORD = 'test-password';
    process.env.ACTUAL_SYNC_ID = 'test-sync-uuid';
    process.env.ACTUAL_ACCOUNT_ID = 'test-account-uuid';
    process.env.LOG_LEVEL = 'error';
  });

  afterEach(() => {
    process.env = originalEnv;
    delete require.cache[require.resolve('dotenv')];
  });

  it('reads UP_API_TOKEN into config.up.apiToken', () => {
    clearModuleCache(['config']);
    const { config } = require('../config');
    assert.equal(config.up.apiToken, 'up:yeah:test-token');
  });

  it('defaults sync window to 48 hours', () => {
    delete process.env.SYNC_WINDOW_HOURS;
    clearModuleCache(['config']);
    const { config } = require('../config');
    assert.equal(config.sync.windowHours, 48);
  });

  it('parses SYNC_WINDOW_HOURS as an integer', () => {
    process.env.SYNC_WINDOW_HOURS = '72';
    clearModuleCache(['config']);
    const { config } = require('../config');
    assert.equal(config.sync.windowHours, 72);
  });

  it('defaults maxRetries to 4', () => {
    delete process.env.MAX_RETRIES;
    clearModuleCache(['config']);
    const { config } = require('../config');
    assert.equal(config.sync.maxRetries, 4);
  });

  it('defaults webhookUrl to null', () => {
    delete process.env.WEBHOOK_URL;
    clearModuleCache(['config']);
    const { config } = require('../config');
    assert.equal(config.webhookUrl, null);
  });

  it('sets the Up Bank base URL', () => {
    clearModuleCache(['config']);
    const { config } = require('../config');
    assert.equal(config.up.baseUrl, 'https://api.up.com.au/api/v1');
  });

  it('is frozen at the top level', () => {
    clearModuleCache(['config']);
    const { config } = require('../config');
    assert.ok(Object.isFrozen(config));
  });

  it('has frozen nested objects', () => {
    clearModuleCache(['config']);
    const { config } = require('../config');
    assert.ok(Object.isFrozen(config.up));
    assert.ok(Object.isFrozen(config.actual));
    assert.ok(Object.isFrozen(config.sync));
  });
});
