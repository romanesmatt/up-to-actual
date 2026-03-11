const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { setTestEnv, clearModuleCache, mockFetchResponse, makeUpTransaction } = require('./helpers/fixtures');

describe('upbank', () => {
  let originalFetch;
  let originalEnv;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    setTestEnv();
    clearModuleCache(['config', 'logger', 'upbank']);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    mock.restoreAll();
  });

  describe('ping', () => {
    it('returns true on successful ping', async () => {
      globalThis.fetch = mock.fn(() =>
        Promise.resolve(mockFetchResponse({ meta: { statusEmoji: '⚡' } }))
      );
      const { ping } = require('../upbank');
      const result = await ping();
      assert.equal(result, true);
    });

    it('sends correct Authorization header', async () => {
      const fetchMock = mock.fn(() =>
        Promise.resolve(mockFetchResponse({ meta: {} }))
      );
      globalThis.fetch = fetchMock;
      const { ping } = require('../upbank');
      await ping();

      const headers = fetchMock.mock.calls[0].arguments[1].headers;
      assert.ok(headers.Authorization.startsWith('Bearer '));
      assert.equal(headers.Accept, 'application/json');
    });

    it('throws on HTTP 401 (invalid token)', async () => {
      globalThis.fetch = mock.fn(() =>
        Promise.resolve(mockFetchResponse(
          { errors: [{ status: '401', title: 'Not Authorized', detail: 'Invalid token' }] },
          401
        ))
      );
      const { ping } = require('../upbank');
      await assert.rejects(() => ping(), /Up Bank API ping failed.*401/);
    });

    it('includes error detail from response body', async () => {
      globalThis.fetch = mock.fn(() =>
        Promise.resolve(mockFetchResponse(
          { errors: [{ detail: 'Token has been revoked' }] },
          403
        ))
      );
      const { ping } = require('../upbank');
      await assert.rejects(() => ping(), /Token has been revoked/);
    });
  });

  describe('fetchTransactions', () => {
    it('returns transactions from a single page', async () => {
      const recentSettle = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const txns = [
        makeUpTransaction({ id: 'txn_1', attributes: { settledAt: recentSettle } }),
        makeUpTransaction({ id: 'txn_2', attributes: { settledAt: recentSettle } }),
      ];
      globalThis.fetch = mock.fn(() =>
        Promise.resolve(mockFetchResponse({
          data: txns,
          links: { next: null },
        }))
      );
      const { fetchTransactions } = require('../upbank');
      const result = await fetchTransactions();

      assert.equal(result.length, 2);
      assert.equal(result[0].id, 'txn_1');
      assert.equal(result[1].id, 'txn_2');
    });

    it('follows pagination and concatenates results', async () => {
      const recentSettle = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const page1 = [makeUpTransaction({ id: 'txn_1', attributes: { settledAt: recentSettle } })];
      const page2 = [makeUpTransaction({ id: 'txn_2', attributes: { settledAt: recentSettle } })];

      let callCount = 0;
      globalThis.fetch = mock.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(mockFetchResponse({
            data: page1,
            links: { next: 'https://api.up.com.au/api/v1/transactions?page[after]=cursor1' },
          }));
        }
        return Promise.resolve(mockFetchResponse({
          data: page2,
          links: { next: null },
        }));
      });

      const { fetchTransactions } = require('../upbank');
      const result = await fetchTransactions();

      assert.equal(result.length, 2);
      assert.equal(result[0].id, 'txn_1');
      assert.equal(result[1].id, 'txn_2');
      assert.equal(globalThis.fetch.mock.calls.length, 2);
    });

    it('returns empty array when no transactions exist', async () => {
      globalThis.fetch = mock.fn(() =>
        Promise.resolve(mockFetchResponse({
          data: [],
          links: { next: null },
        }))
      );
      const { fetchTransactions } = require('../upbank');
      const result = await fetchTransactions();
      assert.deepEqual(result, []);
    });

    it('includes correct query parameters with wider API lookback', async () => {
      const fetchMock = mock.fn(() =>
        Promise.resolve(mockFetchResponse({ data: [], links: { next: null } }))
      );
      globalThis.fetch = fetchMock;

      const { fetchTransactions } = require('../upbank');
      await fetchTransactions();

      const url = new URL(fetchMock.mock.calls[0].arguments[0].toString());
      assert.equal(url.searchParams.get('filter[status]'), 'SETTLED');
      assert.equal(url.searchParams.get('page[size]'), '100');

      // filter[since] should use the wider API lookback (min 720 hours = 30 days),
      // not the sync window directly
      const sinceParam = url.searchParams.get('filter[since]');
      assert.ok(sinceParam);
      const sinceDate = new Date(sinceParam);
      const now = new Date();
      const hoursDiff = (now - sinceDate) / (1000 * 60 * 60);
      // Should be at least 720 hours (30 days) back
      assert.ok(hoursDiff >= 719, `API lookback should be at least 720 hours, got ${hoursDiff.toFixed(0)}`);
    });

    it('throws on HTTP 429 (rate limited)', async () => {
      globalThis.fetch = mock.fn(() =>
        Promise.resolve(mockFetchResponse(
          { errors: [{ detail: 'Rate limited' }] },
          429
        ))
      );
      const { fetchTransactions } = require('../upbank');
      await assert.rejects(() => fetchTransactions(), /rate limited.*429/i);
    });

    it('throws on HTTP 500 (server error)', async () => {
      globalThis.fetch = mock.fn(() =>
        Promise.resolve(mockFetchResponse(
          { errors: [{ detail: 'Internal server error' }] },
          500
        ))
      );
      const { fetchTransactions } = require('../upbank');
      await assert.rejects(() => fetchTransactions(), /500/);
    });
  });

  describe('filterBySettledAt', () => {
    it('keeps transactions settled within the window', () => {
      const recentSettled = new Date();
      recentSettled.setHours(recentSettled.getHours() - 1); // 1 hour ago

      const txns = [
        makeUpTransaction({ id: 'txn_recent', attributes: { settledAt: recentSettled.toISOString() } }),
      ];

      const { filterBySettledAt } = require('../upbank');
      const result = filterBySettledAt(txns, 168);

      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'txn_recent');
    });

    it('excludes transactions settled outside the window', () => {
      const oldSettled = new Date();
      oldSettled.setHours(oldSettled.getHours() - 200); // 200 hours ago, outside 168h window

      const txns = [
        makeUpTransaction({ id: 'txn_old', attributes: { settledAt: oldSettled.toISOString() } }),
      ];

      const { filterBySettledAt } = require('../upbank');
      const result = filterBySettledAt(txns, 168);

      assert.equal(result.length, 0);
    });

    it('captures transactions created before window but settled within it', () => {
      const createdLongAgo = new Date();
      createdLongAgo.setDate(createdLongAgo.getDate() - 10); // Created 10 days ago

      const settledRecently = new Date();
      settledRecently.setHours(settledRecently.getHours() - 2); // Settled 2 hours ago

      const txns = [
        makeUpTransaction({
          id: 'txn_late_settle',
          attributes: {
            createdAt: createdLongAgo.toISOString(),
            settledAt: settledRecently.toISOString(),
          },
        }),
      ];

      const { filterBySettledAt } = require('../upbank');
      const result = filterBySettledAt(txns, 168);

      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'txn_late_settle');
    });

    it('excludes transactions with null settledAt', () => {
      const txns = [
        makeUpTransaction({ id: 'txn_held', attributes: { settledAt: null } }),
      ];

      const { filterBySettledAt } = require('../upbank');
      const result = filterBySettledAt(txns, 168);

      assert.equal(result.length, 0);
    });
  });
});
