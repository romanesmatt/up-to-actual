/**
 * upbank.js — Up Bank API Client
 *
 * Fetches settled transactions from the Up Bank REST API.
 * Uses a two-tier filtering strategy:
 *   1. API level: broad `filter[since]` lookback to limit data volume
 *   2. Application level: precise `settledAt` filter for the sync window
 *
 * This is necessary because the Up Bank API's `filter[since]` filters
 * on `createdAt`, not `settledAt`. Transactions created before the
 * sync window but settled within it would otherwise be missed.
 *
 * Up Bank API Docs: https://developer.up.com.au/
 *
 * SECURITY: The Bearer token is passed via config, never hardcoded.
 */

const { config } = require('./config');
const logger = require('./logger');

// The API lookback is wider than the sync window to catch transactions
// that were created (HELD) before the window but settled within it.
// Minimum 30 days (720 hours), or 4x the sync window, whichever is larger.
const API_LOOKBACK_MULTIPLIER = 4;
const MIN_API_LOOKBACK_HOURS = 720;

/**
 * Build the Authorization header for Up Bank API requests.
 * @returns {Object} Headers object with Authorization and Accept.
 */
function buildHeaders() {
  return {
    Authorization: `Bearer ${config.up.apiToken}`,
    Accept: 'application/json',
  };
}

/**
 * Verify the Up Bank API token is valid by calling the /util/ping endpoint.
 *
 * @returns {Promise<boolean>} true if token is valid
 * @throws {Error} if token is invalid or API is unreachable
 */
async function ping() {
  const url = `${config.up.baseUrl}/util/ping`;
  logger.debug('Pinging Up Bank API', { url });

  const response = await fetch(url, { headers: buildHeaders() });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      `Up Bank API ping failed: HTTP ${response.status} — ${body.errors?.[0]?.detail || 'Unknown error'}`
    );
  }

  const data = await response.json();
  logger.info('Up Bank API authenticated successfully', {
    statusEmoji: data.meta?.statusEmoji,
  });

  return true;
}

/**
 * Filter transactions to only those settled within the sync window.
 *
 * @param {Array} transactions — Up Bank transaction resources
 * @param {number} windowHours — How recently a transaction must have settled
 * @returns {Array} Transactions with settledAt within the window
 */
function filterBySettledAt(transactions, windowHours) {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - windowHours);

  return transactions.filter((txn) => {
    const settledAt = txn.attributes?.settledAt;
    if (!settledAt) return false;
    return new Date(settledAt) >= cutoff;
  });
}

/**
 * Fetch settled transactions from Up Bank within the configured time window.
 *
 * Uses a two-tier filtering strategy:
 *   1. API: broad `filter[since]` lookback (createdAt-based) to limit volume
 *   2. Local: precise `settledAt` filter for the actual sync window
 *
 * Only SETTLED transactions are fetched (not HELD/pending).
 * Handles cursor-based pagination by following `links.next` until null.
 *
 * @returns {Promise<Array>} Array of Up Bank transaction resource objects
 */
async function fetchTransactions() {
  const { windowHours } = config.sync;

  // API-level lookback: wider than the sync window to catch late-settling
  // transactions (e.g. international purchases, hotel holds).
  const apiLookbackHours = Math.max(windowHours * API_LOOKBACK_MULTIPLIER, MIN_API_LOOKBACK_HOURS);
  const sinceDate = new Date();
  sinceDate.setHours(sinceDate.getHours() - apiLookbackHours);
  const sinceISO = sinceDate.toISOString();

  logger.info('Fetching settled transactions from Up Bank', {
    apiLookbackHours,
    syncWindowHours: windowHours,
    since: sinceISO,
  });

  let allTransactions = [];
  let pageCount = 0;

  // Initial URL with filters
  let url = new URL(`${config.up.baseUrl}/transactions`);
  url.searchParams.set('filter[since]', sinceISO);
  url.searchParams.set('filter[status]', 'SETTLED');
  url.searchParams.set('page[size]', '100');

  while (url) {
    pageCount++;
    logger.debug(`Fetching page ${pageCount}`, { url: url.toString() });

    const response = await fetch(url.toString(), { headers: buildHeaders() });

    // Log rate limit info if available
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    if (rateLimitRemaining !== null) {
      logger.debug('Rate limit status', {
        remaining: rateLimitRemaining,
      });

      if (parseInt(rateLimitRemaining, 10) < 10) {
        logger.warn('Up Bank API rate limit running low', {
          remaining: rateLimitRemaining,
        });
      }
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));

      // Handle rate limiting (429) specifically
      if (response.status === 429) {
        throw new Error(
          'Up Bank API rate limited (HTTP 429). Will retry with backoff.'
        );
      }

      throw new Error(
        `Up Bank API error: HTTP ${response.status} — ${body.errors?.[0]?.detail || 'Unknown error'}`
      );
    }

    const data = await response.json();
    const transactions = data.data || [];
    allTransactions = allTransactions.concat(transactions);

    logger.debug(`Page ${pageCount} returned ${transactions.length} transactions`);

    // Follow cursor-based pagination
    // links.next is null when there are no more pages
    const nextLink = data.links?.next || null;
    url = nextLink ? new URL(nextLink) : null;
  }

  logger.info('Fetched transactions from Up Bank API', {
    totalFromApi: allTransactions.length,
    pages: pageCount,
  });

  // Local filter: keep only transactions settled within the sync window.
  // This is the precise filter — the API lookback was intentionally broader.
  const settled = filterBySettledAt(allTransactions, windowHours);

  logger.info('Filtered to transactions settled within sync window', {
    beforeFilter: allTransactions.length,
    afterFilter: settled.length,
    excluded: allTransactions.length - settled.length,
    syncWindowHours: windowHours,
  });

  return settled;
}

module.exports = { ping, fetchTransactions, filterBySettledAt };
