/**
 * backoff.js — Exponential backoff delay calculation
 *
 * Extracted from index.js for testability. The orchestrator runs
 * main() immediately on require, so pure functions need to live
 * in their own module to be unit-testable.
 */

/**
 * Calculate the delay in milliseconds for exponential backoff.
 * Attempt 0 → 5 min, Attempt 1 → 15 min, Attempt 2 → 45 min
 *
 * @param {number} attempt — Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const baseDelayMs = 5 * 60 * 1000; // 5 minutes
  return baseDelayMs * Math.pow(3, attempt);
}

module.exports = { getBackoffDelay };
