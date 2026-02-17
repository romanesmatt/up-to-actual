/**
 * test-actual.js — Test Actual Budget API Connection
 *
 * Standalone script to verify your Actual Budget server credentials
 * and list all accounts with their IDs. Use this to find the
 * ACTUAL_ACCOUNT_ID to add to your .env file.
 *
 * Usage: npm run test:actual
 *
 * NOTE: ACTUAL_ACCOUNT_ID is not required for this test script,
 * since its purpose is to help you find that ID.
 */

require('dotenv').config();

const api = require('@actual-app/api');

async function main() {
  const serverUrl = process.env.ACTUAL_SERVER_URL;
  const password = process.env.ACTUAL_PASSWORD;
  const syncId = process.env.ACTUAL_SYNC_ID;
  const e2ePassword = process.env.ACTUAL_E2E_PASSWORD || null;

  // Validate minimum required vars for this test
  if (!serverUrl || !password || !syncId) {
    console.error('ERROR: Set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and ACTUAL_SYNC_ID in .env');
    process.exit(1);
  }

  console.log('Testing Actual Budget API connection...\n');

  // Connect
  console.log('1. Connecting to Actual Budget server...');
  await api.init({
    dataDir: './actual-data',
    serverURL: serverUrl,
    password: password,
  });

  const downloadOptions = e2ePassword ? { password: e2ePassword } : undefined;
  await api.downloadBudget(syncId, downloadOptions);
  console.log('   ✅ Connected and budget downloaded\n');

  // List accounts
  console.log('2. Accounts in your budget:');
  console.log('   ' + '-'.repeat(70));

  const accounts = await api.getAccounts();
  for (const account of accounts) {
    const closed = account.closed ? ' (CLOSED)' : '';
    console.log(
      `   ID: ${account.id}\n` +
      `   Name: ${account.name}${closed}\n` +
      `   Type: ${account.type || 'N/A'}\n` +
      `   ' + '-'.repeat(70)`
    );
  }

  console.log(
    `\n   Copy the ID of the account you want to sync with Up Bank\n` +
    `   and set it as ACTUAL_ACCOUNT_ID in your .env file.`
  );

  // Disconnect
  await api.shutdown();
  console.log('\n   ✅ Disconnected from Actual Budget');
}

main().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
});
