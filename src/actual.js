/**
 * actual.js — Actual Budget API Client
 *
 * Connects to an Actual Budget server instance via the official
 * @actual-app/api Node.js package. Downloads the budget file,
 * imports transactions with deduplication, and disconnects.
 *
 * Actual Budget API Docs: https://actualbudget.org/docs/api/
 *
 * IMPORTANT: Actual's API works on a local copy of the budget.
 * Changes are synced back to the server on shutdown.
 */

const api = require('@actual-app/api');
const { config } = require('./config');
const logger = require('./logger');

/**
 * Initialise the Actual Budget API connection.
 * Downloads the budget file to a local cache directory.
 *
 * @returns {Promise<void>}
 */
async function connect() {
  logger.info('Connecting to Actual Budget server', {
    serverUrl: config.actual.serverUrl,
    syncId: config.actual.syncId,
  });

  await api.init({
    dataDir: config.actual.dataDir,
    serverURL: config.actual.serverUrl,
    password: config.actual.password,
  });

  // Download the budget file (with optional E2E encryption)
  const downloadOptions = config.actual.e2ePassword
    ? { password: config.actual.e2ePassword }
    : undefined;

  await api.downloadBudget(config.actual.syncId, downloadOptions);

  logger.info('Connected to Actual Budget and downloaded budget');
}

/**
 * Import transformed transactions into the configured Actual account.
 *
 * Uses importTransactions() which:
 *   - Runs all payee rules for automatic categorisation
 *   - Deduplicates via imported_id (no duplicates across syncs)
 *   - Handles payee creation (new payees are auto-created)
 *
 * @param {Array} transactions — Transformed transaction objects
 * @returns {Promise<Object>} Import result: { errors, added, updated }
 */
async function importTransactions(transactions) {
  if (transactions.length === 0) {
    logger.info('No transactions to import');
    return { errors: [], added: [], updated: [] };
  }

  logger.info('Importing transactions into Actual Budget', {
    accountId: config.actual.accountId,
    count: transactions.length,
  });

  const result = await api.importTransactions(
    config.actual.accountId,
    transactions
  );

  logger.info('Import complete', {
    added: result.added?.length || 0,
    updated: result.updated?.length || 0,
    errors: result.errors?.length || 0,
  });

  if (result.errors && result.errors.length > 0) {
    logger.warn('Import errors encountered', { errors: result.errors });
  }

  return result;
}

/**
 * List all accounts in the budget.
 * Useful for finding the account ID to configure.
 *
 * @returns {Promise<Array>} Array of account objects
 */
async function listAccounts() {
  const accounts = await api.getAccounts();
  return accounts;
}

/**
 * Cleanly disconnect from Actual Budget.
 * This syncs any pending changes back to the server.
 *
 * @returns {Promise<void>}
 */
async function disconnect() {
  logger.info('Disconnecting from Actual Budget (syncing changes)');
  await api.shutdown();
  logger.info('Disconnected from Actual Budget');
}

module.exports = { connect, importTransactions, listAccounts, disconnect };
