/**
 * upbank.js — Up Bank API Client
 *
 * Fetches settled transactions from the Up Bank REST API for the
 * configured rolling time window. Handles cursor-based pagination
 * and rate limit awareness.
 *
 * Up Bank API Docs: https://developer.up.com.au/
 *
 * SECURITY: The Bearer token is passed via config, never hardcoded.
 */

const { config } = require('./config');
const logger = require('./logger');

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
 * Fetch settled transactions from Up Bank within the configured time window.
 *
 * Uses filter[since] with an RFC 3339 datetime string to retrieve
 * transactions from the last `config.sync.windowHours` hours.
 * Only SETTLED transactions are fetched (not HELD/pending).
 *
 * Handles cursor-based pagination by following `links.next` until null.
 *
 * @returns {Promise<Array>} Array of Up Bank transaction resource objects
 */
async function fetchTransactions() {
  const sinceDate = new Date();
  sinceDate.setHours(sinceDate.getHours() - config.sync.windowHours);
  const sinceISO = sinceDate.toISOString();

  logger.info('Fetching settled transactions from Up Bank', {
    since: sinceISO,
    windowHours: config.sync.windowHours,
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

  logger.info('Finished fetching transactions from Up Bank', {
    totalTransactions: allTransactions.length,
    pages: pageCount,
  });

  return allTransactions;
}

module.exports = { ping, fetchTransactions };
