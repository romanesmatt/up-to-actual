const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { makeUpTransaction } = require('./helpers/fixtures');

// Set env so config.js loads without error (imported transitively via logger)
process.env.UP_API_TOKEN = 'test';
process.env.ACTUAL_SERVER_URL = 'https://test.example.com';
process.env.ACTUAL_PASSWORD = 'test';
process.env.ACTUAL_SYNC_ID = 'test-uuid';
process.env.ACTUAL_ACCOUNT_ID = 'test-uuid';
process.env.LOG_LEVEL = 'error';

const {
  extractDate,
  transformTransaction,
  transformTransactions,
} = require('../transform');

describe('extractDate', () => {
  it('extracts YYYY-MM-DD from ISO datetime with positive offset', () => {
    assert.equal(extractDate('2026-01-26T04:51:32+11:00'), '2026-01-26');
  });

  it('extracts YYYY-MM-DD from ISO datetime with UTC Z suffix', () => {
    assert.equal(extractDate('2026-01-01T00:00:00Z'), '2026-01-01');
  });

  it('extracts YYYY-MM-DD from ISO datetime with negative offset', () => {
    // Uses the string prefix, not Date parsing — so no timezone shift
    assert.equal(extractDate('2025-12-31T23:00:00-05:00'), '2025-12-31');
  });

  it('handles datetime without timezone offset', () => {
    assert.equal(extractDate('2026-06-15T12:30:00'), '2026-06-15');
  });
});

describe('transformTransaction', () => {
  it('maps all fields correctly for a standard outgoing transaction', () => {
    const up = makeUpTransaction();
    const result = transformTransaction(up);

    assert.deepEqual(result, {
      imported_id: 'txn_abc123',
      payee_name: 'Woolworths',
      amount: -5998,
      date: '2026-01-26',
      notes: null,
      cleared: true,
    });
  });

  it('maps a positive amount (incoming transaction, e.g. salary)', () => {
    const up = makeUpTransaction({
      id: 'txn_salary',
      attributes: {
        description: 'Employer Pty Ltd',
        amount: { valueInBaseUnits: 350000, value: '3500.00', currencyCode: 'AUD' },
        createdAt: '2026-02-15T09:00:00+11:00',
        message: 'Salary Feb 2026',
      },
    });
    const result = transformTransaction(up);

    assert.equal(result.imported_id, 'txn_salary');
    assert.equal(result.payee_name, 'Employer Pty Ltd');
    assert.equal(result.amount, 350000);
    assert.equal(result.date, '2026-02-15');
    assert.equal(result.notes, 'Salary Feb 2026');
    assert.equal(result.cleared, true);
  });

  it('sets notes when message is present', () => {
    const up = makeUpTransaction({
      attributes: { message: 'Coffee catch-up' },
    });
    const result = transformTransaction(up);

    assert.equal(result.notes, 'Coffee catch-up');
  });

  it('sets notes to null when message is null', () => {
    const up = makeUpTransaction({
      attributes: { message: null },
    });
    const result = transformTransaction(up);

    assert.equal(result.notes, null);
  });

  it('always sets cleared to true', () => {
    const up = makeUpTransaction();
    const result = transformTransaction(up);

    assert.equal(result.cleared, true);
  });

  it('uses valueInBaseUnits directly without float conversion', () => {
    // The amount field should be the exact integer from Up, not parsed from the string
    const up = makeUpTransaction({
      attributes: {
        amount: { valueInBaseUnits: -1, value: '-0.01', currencyCode: 'AUD' },
      },
    });
    const result = transformTransaction(up);

    assert.equal(result.amount, -1);
  });
});

describe('transformTransactions', () => {
  it('returns an empty array for empty input', () => {
    const result = transformTransactions([]);
    assert.deepEqual(result, []);
  });

  it('transforms multiple transactions', () => {
    const transactions = [
      makeUpTransaction({ id: 'txn_1' }),
      makeUpTransaction({ id: 'txn_2' }),
      makeUpTransaction({ id: 'txn_3' }),
    ];
    const result = transformTransactions(transactions);

    assert.equal(result.length, 3);
    assert.equal(result[0].imported_id, 'txn_1');
    assert.equal(result[1].imported_id, 'txn_2');
    assert.equal(result[2].imported_id, 'txn_3');
  });

  it('each transformed transaction has all required fields', () => {
    const transactions = [makeUpTransaction()];
    const result = transformTransactions(transactions);
    const requiredFields = ['imported_id', 'payee_name', 'amount', 'date', 'notes', 'cleared'];

    for (const field of requiredFields) {
      assert.ok(field in result[0], `Missing field: ${field}`);
    }
  });
});
