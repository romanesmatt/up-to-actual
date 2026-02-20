const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { clearModuleCache } = require('./helpers/fixtures');

describe('validateConfig', () => {
  let originalEnv;
  let exitMock;

  beforeEach(() => {
    originalEnv = { ...process.env };
    exitMock = mock.method(process, 'exit', () => {});
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
    mock.restoreAll();
  });

  it('does not exit when all required vars are present', () => {
    const { validateConfig } = require('../config');
    validateConfig();
    assert.equal(exitMock.mock.calls.length, 0);
  });

  it('calls process.exit(1) when UP_API_TOKEN is missing', () => {
    delete process.env.UP_API_TOKEN;
    clearModuleCache(['config']);
    const { validateConfig } = require('../config');
    validateConfig();
    assert.equal(exitMock.mock.calls.length, 1);
    assert.equal(exitMock.mock.calls[0].arguments[0], 1);
  });

  it('calls process.exit(1) when ACTUAL_SERVER_URL is missing', () => {
    delete process.env.ACTUAL_SERVER_URL;
    clearModuleCache(['config']);
    const { validateConfig } = require('../config');
    validateConfig();
    assert.equal(exitMock.mock.calls.length, 1);
  });

  it('calls process.exit(1) when multiple vars are missing', () => {
    delete process.env.UP_API_TOKEN;
    delete process.env.ACTUAL_PASSWORD;
    delete process.env.ACTUAL_SYNC_ID;
    clearModuleCache(['config']);
    const { validateConfig } = require('../config');
    validateConfig();
    assert.equal(exitMock.mock.calls.length, 1);
  });
});

describe('config object', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.UP_API_TOKEN = 'up:yeah:test-token';
    process.env.ACTUAL_SERVER_URL = 'https://test.pikapods.net';
    process.env.ACTUAL_PASSWORD = 'test-password';
    process.env.ACTUAL_SYNC_ID = 'test-sync-uuid';
    process.env.ACTUAL_ACCOUNT_ID = 'test-account-uuid';
    process.env.LOG_LEVEL = 'error';
  });

  afterEach(() => {
    process.env = originalEnv;
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
