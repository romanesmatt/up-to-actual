/**
 * index.js — Main Orchestrator
 *
 * Coordinates the full sync pipeline:
 *   1. Validate configuration
 *   2. Ping Up Bank API (verify auth)
 *   3. Fetch settled transactions (last 48h)
 *   4. Transform Up → Actual format
 *   5. Connect to Actual Budget
 *   6. Import transactions (with deduplication)
 *   7. Disconnect (sync changes to server)
 *   8. Send webhook notification
 *
 * Implements exponential backoff retry on transient failures.
 * Retry delays: 5min → 15min → 45min (max 4 attempts total).
 */

const { config, validateConfig } = require('./config');
const { executeSyncAttempt } = require('./sync');
const { notifySuccess, notifyFailure } = require('./notify');
const { getBackoffDelay } = require('./backoff');
const logger = require('./logger');

/**
 * Sleep for the specified duration.
 *
 * @param {number} ms — Duration in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main entry point — run the sync with retry logic.
 */
async function main() {
  logger.info('=== Up to Actual sync starting ===', {
    windowHours: config.sync.windowHours,
    maxRetries: config.sync.maxRetries,
  });

  const maxAttempts = config.sync.maxRetries;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info(`Sync attempt ${attempt} of ${maxAttempts}`);

      const { result, fetchedCount, durationMs } = await executeSyncAttempt();

      // Success — send notification and exit
      logger.info('=== Sync completed successfully ===', {
        added: result.added?.length || 0,
        updated: result.updated?.length || 0,
        fetched: fetchedCount,
        durationMs,
      });

      await notifySuccess(result, fetchedCount, durationMs);
      return;
    } catch (error) {
      lastError = error;
      logger.error(`Sync attempt ${attempt} failed`, {
        error: error.message,
        attempt,
        maxAttempts,
      });

      // If this was not the last attempt, wait with exponential backoff
      if (attempt < maxAttempts) {
        const delayMs = getBackoffDelay(attempt - 1);
        const delayMin = (delayMs / 1000 / 60).toFixed(0);
        logger.info(`Retrying in ${delayMin} minutes...`, {
          nextAttempt: attempt + 1,
          delayMs,
        });
        await sleep(delayMs);
      }
    }
  }

  // All attempts exhausted
  logger.error('=== Sync FAILED — all retry attempts exhausted ===', {
    totalAttempts: maxAttempts,
    lastError: lastError?.message,
  });

  await notifyFailure(lastError?.message || 'Unknown error', maxAttempts);
  process.exit(1);
}

// Validate config before anything else
try {
  validateConfig();
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}

// Run
main().catch((error) => {
  logger.error('Unexpected fatal error', { error: error.message });
  process.exit(1);
});
