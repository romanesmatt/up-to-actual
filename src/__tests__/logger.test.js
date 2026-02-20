const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { clearModuleCache } = require('./helpers/fixtures');

describe('logger', () => {
  let originalEnv;
  let logMock;
  let errorMock;

  beforeEach(() => {
    originalEnv = { ...process.env };
    logMock = mock.method(console, 'log', () => {});
    errorMock = mock.method(console, 'error', () => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restoreAll();
  });

  function requireLogger(level) {
    process.env.LOG_LEVEL = level;
    clearModuleCache(['logger']);
    return require('../logger');
  }

  describe('log level filtering', () => {
    it('suppresses debug when level is info', () => {
      const logger = requireLogger('info');
      logger.debug('hidden message');
      assert.equal(logMock.mock.calls.length, 0);
    });

    it('outputs info when level is info', () => {
      const logger = requireLogger('info');
      logger.info('visible message');
      assert.equal(logMock.mock.calls.length, 1);
    });

    it('outputs all levels when level is debug', () => {
      const logger = requireLogger('debug');
      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');
      // debug, info, warn go to console.log; error goes to console.error
      assert.equal(logMock.mock.calls.length, 3);
      assert.equal(errorMock.mock.calls.length, 1);
    });

    it('only outputs error when level is error', () => {
      const logger = requireLogger('error');
      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('hidden');
      logger.error('visible');
      assert.equal(logMock.mock.calls.length, 0);
      assert.equal(errorMock.mock.calls.length, 1);
    });
  });

  describe('output format', () => {
    it('writes valid JSON to console.log', () => {
      const logger = requireLogger('info');
      logger.info('test message');
      const output = logMock.mock.calls[0].arguments[0];
      const parsed = JSON.parse(output);
      assert.equal(typeof parsed, 'object');
    });

    it('includes timestamp, level, and message fields', () => {
      const logger = requireLogger('info');
      logger.info('test message');
      const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
      assert.ok(parsed.timestamp);
      assert.equal(parsed.level, 'info');
      assert.equal(parsed.message, 'test message');
    });

    it('includes extra data properties', () => {
      const logger = requireLogger('info');
      logger.info('with data', { count: 5, status: 'ok' });
      const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
      assert.equal(parsed.count, 5);
      assert.equal(parsed.status, 'ok');
    });

    it('outputs ISO 8601 timestamps', () => {
      const logger = requireLogger('info');
      logger.info('timestamp check');
      const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
      // Should not throw — valid ISO string
      const date = new Date(parsed.timestamp);
      assert.ok(!isNaN(date.getTime()));
    });
  });

  describe('output streams', () => {
    it('sends error level to console.error', () => {
      const logger = requireLogger('debug');
      logger.error('error message');
      assert.equal(errorMock.mock.calls.length, 1);
      assert.equal(logMock.mock.calls.length, 0);
    });

    it('sends info level to console.log', () => {
      const logger = requireLogger('debug');
      logger.info('info message');
      assert.equal(logMock.mock.calls.length, 1);
      assert.equal(errorMock.mock.calls.length, 0);
    });

    it('sends warn level to console.log', () => {
      const logger = requireLogger('debug');
      logger.warn('warn message');
      assert.equal(logMock.mock.calls.length, 1);
      assert.equal(errorMock.mock.calls.length, 0);
    });
  });
});
