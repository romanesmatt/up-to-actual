/**
 * test-up.js — Test Up Bank API Connection
 *
 * Standalone script to verify your Up Bank API token works
 * and preview what transactions will be fetched.
 *
 * Usage: npm run test:up
 */

require('dotenv').config();

const { ping, fetchTransactions } = require('./upbank');

async function main() {
  if (!process.env.UP_API_TOKEN) {
    console.error('ERROR: Set UP_API_TOKEN in .env');
    process.exit(1);
  }

  console.log('Testing Up Bank API connection...\n');

  // Test 1: Ping
  console.log('1. Pinging Up Bank API...');
  await ping();
  console.log('   ✅ Token is valid\n');

  // Test 2: Fetch recent transactions
  console.log('2. Fetching recent settled transactions...');
  const transactions = await fetchTransactions();
  console.log(`   ✅ Found ${transactions.length} transactions\n`);

  // Test 3: Validate response shape — ensure Up's API returns the fields we depend on
  if (transactions.length > 0) {
    console.log('3. Validating transaction response shape...');
    const t = transactions[0];
    const requiredFields = ['id', 'attributes'];
    const requiredAttributes = ['description', 'amount', 'createdAt', 'status'];

    for (const field of requiredFields) {
      if (!(field in t)) throw new Error(`Missing top-level field: ${field}`);
    }
    for (const attr of requiredAttributes) {
      if (!(attr in t.attributes)) throw new Error(`Missing attributes.${attr}`);
    }
    if (!('valueInBaseUnits' in t.attributes.amount)) {
      throw new Error('Missing attributes.amount.valueInBaseUnits');
    }
    if (typeof t.attributes.amount.valueInBaseUnits !== 'number') {
      throw new Error(`Expected valueInBaseUnits to be a number, got ${typeof t.attributes.amount.valueInBaseUnits}`);
    }
    if (typeof t.attributes.description !== 'string') {
      throw new Error(`Expected description to be a string, got ${typeof t.attributes.description}`);
    }
    if (t.attributes.status !== 'SETTLED') {
      throw new Error(`Expected status SETTLED, got ${t.attributes.status}`);
    }
    console.log('   ✅ Response shape matches expected schema\n');

    // Test 4: Display sample transactions
    console.log('4. Sample transactions (most recent 5):');
    console.log('   ' + '-'.repeat(70));

    const sample = transactions.slice(0, 5);
    for (const txn of sample) {
      const { attributes } = txn;
      const amount = (attributes.amount.valueInBaseUnits / 100).toFixed(2);
      const date = attributes.createdAt.substring(0, 10);
      const status = attributes.status;
      const method = attributes.cardPurchaseMethod?.method || 'N/A';

      console.log(
        `   ${date} | $${amount.padStart(10)} | ${status.padEnd(7)} | ${method.padEnd(12)} | ${attributes.description}`
      );
    }

    console.log('   ' + '-'.repeat(70));
    console.log(`\n   Total: ${transactions.length} settled transactions in window`);
  }
}

main().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
});
