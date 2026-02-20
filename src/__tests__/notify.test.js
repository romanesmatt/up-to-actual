const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { setTestEnv, clearModuleCache, mockFetchResponse } = require('./helpers/fixtures');

describe('isDiscordWebhook', () => {
  let isDiscordWebhook;

  beforeEach(() => {
    setTestEnv();
    clearModuleCache(['config', 'logger', 'notify']);
    ({ isDiscordWebhook } = require('../notify'));
  });

  it('returns true for a Discord webhook URL', () => {
    assert.equal(isDiscordWebhook('https://discord.com/api/webhooks/123/abc'), true);
  });

  it('returns false for an Ntfy URL', () => {
    assert.equal(isDiscordWebhook('https://ntfy.sh/mytopic'), false);
  });

  it('returns false for a generic URL', () => {
    assert.equal(isDiscordWebhook('https://example.com/webhook'), false);
  });
});

describe('sendNotification', () => {
  let sendNotification;
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setTestEnv({ WEBHOOK_URL: 'https://ntfy.sh/test-topic' });
    clearModuleCache(['config', 'logger', 'notify']);
    ({ sendNotification } = require('../notify'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  });

  it('skips fetch when no webhook URL is configured', async () => {
    // Re-require with no WEBHOOK_URL
    delete process.env.WEBHOOK_URL;
    clearModuleCache(['config', 'logger', 'notify']);
    const mod = require('../notify');

    const fetchMock = mock.fn(() => Promise.resolve(mockFetchResponse({})));
    globalThis.fetch = fetchMock;

    await mod.sendNotification('test message');
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it('sends plain text for non-Discord webhooks', async () => {
    const fetchMock = mock.fn(() => Promise.resolve(mockFetchResponse({})));
    globalThis.fetch = fetchMock;

    await sendNotification('test message');

    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, 'https://ntfy.sh/test-topic');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'text/plain');
    assert.equal(options.body, 'test message');
  });

  it('sends JSON for Discord webhooks', async () => {
    delete process.env.WEBHOOK_URL;
    setTestEnv({ WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc' });
    clearModuleCache(['config', 'logger', 'notify']);
    const mod = require('../notify');

    const fetchMock = mock.fn(() => Promise.resolve(mockFetchResponse({})));
    globalThis.fetch = fetchMock;

    await mod.sendNotification('test message');

    const [, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { content: 'test message' });
  });

  it('does not throw when fetch returns a non-ok response', async () => {
    const fetchMock = mock.fn(() => Promise.resolve(mockFetchResponse({}, 500)));
    globalThis.fetch = fetchMock;

    // Should not throw
    await sendNotification('test message');
  });

  it('does not throw when fetch rejects with a network error', async () => {
    const fetchMock = mock.fn(() => Promise.reject(new Error('Network error')));
    globalThis.fetch = fetchMock;

    // Should not throw
    await sendNotification('test message');
  });
});

describe('notifySuccess', () => {
  let notifySuccess;
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setTestEnv({ WEBHOOK_URL: 'https://ntfy.sh/test-topic' });
    clearModuleCache(['config', 'logger', 'notify']);
    ({ notifySuccess } = require('../notify'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  });

  it('includes counts and duration in the notification', async () => {
    const fetchMock = mock.fn(() => Promise.resolve(mockFetchResponse({})));
    globalThis.fetch = fetchMock;

    const result = { added: ['a', 'b'], updated: ['c'], errors: [] };
    await notifySuccess(result, 10, 3500);

    const body = fetchMock.mock.calls[0].arguments[1].body;
    assert.ok(body.includes('Fetched: 10'));
    assert.ok(body.includes('Added: 2'));
    assert.ok(body.includes('Updated: 1'));
    assert.ok(body.includes('Skipped: 7'));
    assert.ok(body.includes('3.5s'));
  });
});

describe('notifyFailure', () => {
  let notifyFailure;
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setTestEnv({ WEBHOOK_URL: 'https://ntfy.sh/test-topic' });
    clearModuleCache(['config', 'logger', 'notify']);
    ({ notifyFailure } = require('../notify'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  });

  it('includes error message and attempt count', async () => {
    const fetchMock = mock.fn(() => Promise.resolve(mockFetchResponse({})));
    globalThis.fetch = fetchMock;

    await notifyFailure('Connection refused', 4);

    const body = fetchMock.mock.calls[0].arguments[1].body;
    assert.ok(body.includes('FAILED after 4 attempts'));
    assert.ok(body.includes('Connection refused'));
  });
});
