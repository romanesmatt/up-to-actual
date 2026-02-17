/**
 * test-up.js — Test Up Bank API Connection
 *
 * Standalone script to verify your Up Bank API token works
 * and preview what transactions will be fetched.
 *
 * Usage: npm run test:up
 */

const { validateConfig } = require('./config');
const { ping, fetchTransactions } = require('./upbank');

async function main() {
  console.log('Testing Up Bank API connection...\n');

  // Test 1: Ping
  console.log('1. Pinging Up Bank API...');
  await ping();
  console.log('   ✅ Token is valid\n');

  // Test 2: Fetch recent transactions
  console.log('2. Fetching recent settled transactions...');
  const transactions = await fetchTransactions();
  console.log(`   ✅ Found ${transactions.length} transactions\n`);

  // Display a sample
  if (transactions.length > 0) {
    console.log('3. Sample transactions (most recent 5):');
    console.log('   ' + '-'.repeat(70));

    const sample = transactions.slice(0, 5);
    for (const t of sample) {
      const { attributes } = t;
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

validateConfig();
main().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
});
