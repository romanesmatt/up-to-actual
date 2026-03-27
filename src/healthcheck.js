/**
 * healthcheck.js — Connectivity Health Check
 *
 * Validates configuration and tests connectivity to both Up Bank
 * and Actual Budget APIs. Designed for use with monitoring tools
 * like Uptime Kuma — exits 0 on success, 1 on failure.
 *
 * Usage:
 *   node src/healthcheck.js
 *   npm run healthcheck
 */

const { validateConfig } = require('./config');
const { ping } = require('./upbank');
const { connect, disconnect } = require('./actual');
const logger = require('./logger');

async function healthcheck() {
  const checks = { config: false, upBank: false, actualBudget: false };

  // Check 1: Configuration
  try {
    validateConfig();
    checks.config = true;
    logger.info('Config validation passed');
  } catch (error) {
    logger.error('Config validation failed', { error: error.message });
    return checks;
  }

  // Check 2: Up Bank API reachability
  try {
    await ping();
    checks.upBank = true;
    logger.info('Up Bank API reachable');
  } catch (error) {
    logger.error('Up Bank API unreachable', { error: error.message });
  }

  // Check 3: Actual Budget server reachability
  try {
    await connect();
    checks.actualBudget = true;
    logger.info('Actual Budget server reachable');
  } catch (error) {
    logger.error('Actual Budget server unreachable', { error: error.message });
  } finally {
    try {
      await disconnect();
    } catch {
      // Disconnect failure during healthcheck is non-fatal
    }
  }

  return checks;
}

healthcheck()
  .then((checks) => {
    const allPassed = Object.values(checks).every(Boolean);
    const failed = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);

    if (allPassed) {
      logger.info('Health check passed', checks);
      process.exit(0);
    } else {
      logger.error('Health check failed', { failed, checks });
      process.exit(1);
    }
  })
  .catch((error) => {
    logger.error('Health check unexpected error', { error: error.message });
    process.exit(1);
  });
