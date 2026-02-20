/**
 * sync.js — Core sync logic
 *
 * Executes a single sync attempt: fetch transactions from Up Bank,
 * transform them, and import into Actual Budget. Used by both the
 * CLI entry point (index.js) and the Azure Functions timer trigger.
 *
 * This module is intentionally separated from index.js so that the
 * retry loop and process lifecycle concerns stay in their respective
 * entry points (CLI vs serverless).
 */

const fs = require('fs');
const { config } = require('./config');
const { ping, fetchTransactions } = require('./upbank');
const { transformTransactions } = require('./transform');
const { connect, importTransactions, disconnect } = require('./actual');
const logger = require('./logger');

/**
 * Execute a single sync attempt.
 * Returns the result on success, throws on failure.
 *
 * @returns {Promise<Object>} { result, fetchedCount, durationMs }
 */
async function executeSyncAttempt() {
  const startTime = Date.now();

  // Step 1: Verify Up Bank API is reachable and token is valid
  await ping();

  // Step 2: Fetch settled transactions from the rolling window
  const upTransactions = await fetchTransactions();

  if (upTransactions.length === 0) {
    logger.info('No transactions to sync in the current window');
    return {
      result: { errors: [], added: [], updated: [] },
      fetchedCount: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Step 3: Transform Up transactions to Actual format
  const actualTransactions = transformTransactions(upTransactions);

  // Step 4: Ensure data directory exists (needed for /tmp on Azure)
  if (!fs.existsSync(config.actual.dataDir)) {
    fs.mkdirSync(config.actual.dataDir, { recursive: true });
  }

  // Step 5: Connect to Actual Budget and import
  await connect();
  let result;
  try {
    result = await importTransactions(actualTransactions);
  } finally {
    // Always disconnect, even if import fails, to release resources
    await disconnect();
  }

  const durationMs = Date.now() - startTime;

  return { result, fetchedCount: upTransactions.length, durationMs };
}

module.exports = { executeSyncAttempt };
