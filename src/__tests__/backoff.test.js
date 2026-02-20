const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getBackoffDelay } = require('../backoff');

describe('getBackoffDelay', () => {
  it('returns 5 minutes (300000ms) for attempt 0', () => {
    assert.equal(getBackoffDelay(0), 5 * 60 * 1000);
  });

  it('returns 15 minutes (900000ms) for attempt 1', () => {
    assert.equal(getBackoffDelay(1), 15 * 60 * 1000);
  });

  it('returns 45 minutes (2700000ms) for attempt 2', () => {
    assert.equal(getBackoffDelay(2), 45 * 60 * 1000);
  });

  it('follows the formula: 5min * 3^attempt', () => {
    const baseMs = 5 * 60 * 1000;
    for (let i = 0; i < 5; i++) {
      assert.equal(getBackoffDelay(i), baseMs * Math.pow(3, i));
    }
  });
});
