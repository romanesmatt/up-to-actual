const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { setTestEnv, clearModuleCache } = require('./helpers/fixtures');

describe('actual', () => {
  let originalEnv;
  let mockApi;

  beforeEach(() => {
    originalEnv = { ...process.env };
    setTestEnv();

    // Create mock @actual-app/api before requiring actual.js
    mockApi = {
      init: mock.fn(async () => {}),
      downloadBudget: mock.fn(async () => {}),
      importTransactions: mock.fn(async () => ({ added: ['a'], updated: [], errors: [] })),
      getAccounts: mock.fn(async () => [{ id: 'acc_1', name: 'Spending' }]),
      shutdown: mock.fn(async () => {}),
    };

    // Inject mock into require cache BEFORE requiring actual.js
    const apiPath = require.resolve('@actual-app/api');
    require.cache[apiPath] = {
      id: apiPath,
      filename: apiPath,
      loaded: true,
      exports: mockApi,
    };

    clearModuleCache(['config', 'logger', 'actual']);
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clean up the mock from require cache
    delete require.cache[require.resolve('@actual-app/api')];
    mock.restoreAll();
  });

  describe('connect', () => {
    it('calls api.init with correct server config', async () => {
      const { connect } = require('../actual');
      await connect();

      assert.equal(mockApi.init.mock.calls.length, 1);
      const initArgs = mockApi.init.mock.calls[0].arguments[0];
      assert.equal(initArgs.serverURL, 'https://test.pikapods.net');
      assert.equal(initArgs.password, 'test-password');
      assert.ok(initArgs.dataDir);
    });

    it('calls api.downloadBudget with sync ID', async () => {
      const { connect } = require('../actual');
      await connect();

      assert.equal(mockApi.downloadBudget.mock.calls.length, 1);
      assert.equal(mockApi.downloadBudget.mock.calls[0].arguments[0], 'test-sync-uuid');
    });

    it('passes E2E password when configured', async () => {
      process.env.ACTUAL_E2E_PASSWORD = 'my-e2e-pass';
      clearModuleCache(['config', 'logger', 'actual']);

      // Re-inject mock after cache clear
      const apiPath = require.resolve('@actual-app/api');
      require.cache[apiPath] = {
        id: apiPath,
        filename: apiPath,
        loaded: true,
        exports: mockApi,
      };
      clearModuleCache(['actual']);

      const { connect } = require('../actual');
      await connect();

      const downloadArgs = mockApi.downloadBudget.mock.calls[0].arguments;
      assert.deepEqual(downloadArgs[1], { password: 'my-e2e-pass' });
    });

    it('passes undefined for download options when no E2E password', async () => {
      delete process.env.ACTUAL_E2E_PASSWORD;
      clearModuleCache(['config', 'logger', 'actual']);

      const apiPath = require.resolve('@actual-app/api');
      require.cache[apiPath] = {
        id: apiPath,
        filename: apiPath,
        loaded: true,
        exports: mockApi,
      };
      clearModuleCache(['actual']);

      const { connect } = require('../actual');
      await connect();

      const downloadArgs = mockApi.downloadBudget.mock.calls[0].arguments;
      assert.equal(downloadArgs[1], undefined);
    });
  });

  describe('importTransactions', () => {
    it('returns early with empty result for empty array', async () => {
      const { importTransactions } = require('../actual');
      const result = await importTransactions([]);

      assert.deepEqual(result, { errors: [], added: [], updated: [] });
      assert.equal(mockApi.importTransactions.mock.calls.length, 0);
    });

    it('calls api.importTransactions with account ID and data', async () => {
      const { importTransactions } = require('../actual');
      const transactions = [
        { imported_id: 'txn_1', payee_name: 'Test', amount: -100, date: '2026-01-01', cleared: true },
      ];

      await importTransactions(transactions);

      assert.equal(mockApi.importTransactions.mock.calls.length, 1);
      const [accountId, txns] = mockApi.importTransactions.mock.calls[0].arguments;
      assert.equal(accountId, 'test-account-uuid');
      assert.equal(txns.length, 1);
      assert.equal(txns[0].imported_id, 'txn_1');
    });

    it('returns the result from api.importTransactions', async () => {
      const { importTransactions } = require('../actual');
      const result = await importTransactions([{ imported_id: 'txn_1' }]);

      assert.deepEqual(result, { added: ['a'], updated: [], errors: [] });
    });
  });

  describe('listAccounts', () => {
    it('returns accounts from api.getAccounts', async () => {
      const { listAccounts } = require('../actual');
      const accounts = await listAccounts();

      assert.equal(accounts.length, 1);
      assert.equal(accounts[0].id, 'acc_1');
      assert.equal(accounts[0].name, 'Spending');
    });
  });

  describe('disconnect', () => {
    it('calls api.shutdown', async () => {
      const { disconnect } = require('../actual');
      await disconnect();

      assert.equal(mockApi.shutdown.mock.calls.length, 1);
    });
  });
});
