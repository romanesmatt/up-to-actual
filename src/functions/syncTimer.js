/**
 * syncTimer.js — Azure Functions Timer Trigger
 *
 * Thin wrapper around the core sync logic. Runs daily at 2am
 * Melbourne time (configured via WEBSITE_TIME_ZONE app setting).
 *
 * Azure's built-in exponential backoff retry policy handles
 * transient failures — no in-process retry loop needed here.
 *
 * Azure Functions v4 Node.js programming model.
 */

const { app } = require('@azure/functions');

app.timer('syncTimer', {
  // 2am Melbourne time — requires WEBSITE_TIME_ZONE=Australia/Melbourne
  schedule: '0 0 2 * * *',

  handler: async (timer, context) => {
    // Lazy-require modules to avoid side effects at registration time.
    // config.js calls require('dotenv').config() on load, and index.js
    // calls main() on load — both must only run inside the handler.
    const { validateConfig } = require('../config');
    const { executeSyncAttempt } = require('../sync');
    const { notifySuccess, notifyFailure } = require('../notify');
    const logger = require('../logger');

    context.log('Up-to-Actual sync triggered', {
      isPastDue: timer.isPastDue,
      scheduledAt: timer.scheduleStatus?.last,
    });

    if (timer.isPastDue) {
      logger.warn('Timer trigger is past due — running anyway');
    }

    // Validate env vars — throws if missing (Azure marks invocation as failed)
    validateConfig();

    try {
      const { result, fetchedCount, durationMs } = await executeSyncAttempt();

      logger.info('=== Sync completed successfully ===', {
        added: result.added?.length || 0,
        updated: result.updated?.length || 0,
        fetched: fetchedCount,
        durationMs,
      });

      await notifySuccess(result, fetchedCount, durationMs);
    } catch (error) {
      logger.error('Sync failed', { error: error.message });
      await notifyFailure(error.message, 1);

      // Re-throw so Azure marks the invocation as failed
      // and triggers the retry policy
      throw error;
    }
  },

  // Azure's built-in retry — mirrors the existing 5/15/45min pattern.
  // 1 initial attempt + 3 retries = 4 total (matches MAX_RETRIES=4).
  // Intervals are in milliseconds as required by the v4 SDK.
  retry: {
    strategy: 'exponentialBackoff',
    maxRetryCount: 3,
    minimumInterval: 5 * 60 * 1000,   // 5 minutes
    maximumInterval: 45 * 60 * 1000,  // 45 minutes
  },
});
