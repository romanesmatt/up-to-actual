/**
 * transform.js — Transaction Schema Mapper
 *
 * Transforms Up Bank transaction objects into the format expected
 * by Actual Budget's importTransactions() method.
 *
 * Key mappings:
 *   Up id                          → Actual imported_id  (deduplication)
 *   Up attributes.description      → Actual payee_name   (merchant name)
 *   Up attributes.amount.valueInBaseUnits → Actual amount (integer cents)
 *   Up attributes.createdAt        → Actual date         (YYYY-MM-DD)
 *   Up attributes.message          → Actual notes        (optional)
 *
 * Design decision: We use valueInBaseUnits directly because Actual
 * stores amounts as integers internally (e.g. $59.98 = 5998).
 * Up Bank already provides this value, so no float conversion is needed.
 */

const logger = require('./logger');

/**
 * Extract YYYY-MM-DD date string from an ISO 8601 datetime.
 * Uses the local date portion of the original datetime to avoid
 * timezone-related date shifts.
 *
 * @param {string} isoDatetime — e.g. "2026-01-26T04:51:32+11:00"
 * @returns {string} — e.g. "2026-01-26"
 */
function extractDate(isoDatetime) {
  // The ISO string from Up includes timezone offset.
  // Parse it and extract the date in the original timezone.
  // The first 10 characters of an ISO 8601 string are YYYY-MM-DD.
  return isoDatetime.substring(0, 10);
}

/**
 * Transform a single Up Bank transaction into Actual Budget format.
 *
 * @param {Object} upTransaction — A transaction resource from Up's API
 * @returns {Object} Transaction object for Actual's importTransactions()
 */
function transformTransaction(upTransaction) {
  const { id, attributes } = upTransaction;

  return {
    // imported_id is how Actual deduplicates across imports.
    // Using Up's unique transaction ID guarantees no duplicates.
    imported_id: id,

    // The merchant name. Actual's payee rules will automatically
    // match this against existing rules for categorisation.
    payee_name: attributes.description,

    // Amount in integer cents. Negative = outgoing, positive = incoming.
    // Up's valueInBaseUnits is already in this format.
    amount: attributes.amount.valueInBaseUnits,

    // Date as YYYY-MM-DD string, extracted from the ISO datetime.
    // We use createdAt (when the transaction first appeared) rather
    // than settledAt, as createdAt reflects when you actually spent.
    date: extractDate(attributes.createdAt),

    // Optional notes — payment messages or transfer notes.
    // Actual will display this in the transaction's notes field.
    notes: attributes.message || null,

    // Mark as cleared since we only import SETTLED transactions.
    cleared: true,
  };
}

/**
 * Transform an array of Up Bank transactions into Actual Budget format.
 * Logs a summary of the transformation for debugging.
 *
 * @param {Array} upTransactions — Array of Up Bank transaction resources
 * @returns {Array} Array of Actual Budget transaction objects
 */
function transformTransactions(upTransactions) {
  logger.info('Transforming transactions from Up → Actual format', {
    count: upTransactions.length,
  });

  const transformed = upTransactions.map(transformTransaction);

  // Log summary stats for debugging
  const incoming = transformed.filter((t) => t.amount > 0);
  const outgoing = transformed.filter((t) => t.amount < 0);

  logger.debug('Transformation summary', {
    total: transformed.length,
    incoming: incoming.length,
    outgoing: outgoing.length,
    // Sum in dollars for readability (divide integer cents by 100)
    incomingTotal: `$${(incoming.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)}`,
    outgoingTotal: `$${(outgoing.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)}`,
  });

  return transformed;
}

module.exports = { transformTransaction, transformTransactions, extractDate };
