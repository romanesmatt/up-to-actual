/**
 * notify.js — Webhook Notifications
 *
 * Sends notifications via webhook on sync success or failure.
 * Supports Discord webhooks and generic endpoints (Ntfy, Pushover, etc.).
 *
 * Notification failures are logged but never crash the sync process —
 * a failed notification should not prevent transaction importing.
 */

const { config } = require('./config');
const logger = require('./logger');

/**
 * Detect if the webhook URL is a Discord webhook.
 * Discord webhooks require a specific JSON payload format.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isDiscordWebhook(url) {
  return url.includes('discord.com/api/webhooks');
}

/**
 * Send a notification message to the configured webhook.
 * Silently returns if no webhook URL is configured.
 *
 * @param {string} message — The notification message to send
 * @returns {Promise<void>}
 */
async function sendNotification(message) {
  if (!config.webhookUrl) {
    logger.debug('No webhook URL configured, skipping notification');
    return;
  }

  try {
    let body;
    let contentType;

    if (isDiscordWebhook(config.webhookUrl)) {
      // Discord expects { content: "message" }
      body = JSON.stringify({ content: message });
      contentType = 'application/json';
    } else {
      // Generic webhook (Ntfy, Pushover, etc.) — plain text
      body = message;
      contentType = 'text/plain';
    }

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    if (!response.ok) {
      logger.warn('Webhook notification failed', {
        status: response.status,
        statusText: response.statusText,
      });
    } else {
      logger.debug('Webhook notification sent successfully');
    }
  } catch (error) {
    // Never let notification failures crash the sync
    logger.warn('Webhook notification error (non-fatal)', {
      error: error.message,
    });
  }
}

/**
 * Send a success notification summarising the sync results.
 *
 * @param {Object} result — Import result from Actual Budget
 * @param {number} fetchedCount — Total transactions fetched from Up
 * @param {number} durationMs — Sync duration in milliseconds
 */
async function notifySuccess(result, fetchedCount, durationMs) {
  const added = result.added?.length || 0;
  const updated = result.updated?.length || 0;
  const skipped = fetchedCount - added - updated;
  const durationSec = (durationMs / 1000).toFixed(1);

  const message =
    `✅ Up → Actual sync complete\n` +
    `Fetched: ${fetchedCount} | Added: ${added} | Updated: ${updated} | Skipped: ${skipped}\n` +
    `Duration: ${durationSec}s`;

  await sendNotification(message);
}

/**
 * Send a failure notification after all retries have been exhausted.
 *
 * @param {string} errorMessage — Description of the final error
 * @param {number} attempts — Number of attempts made
 */
async function notifyFailure(errorMessage, attempts) {
  const message =
    `❌ Up → Actual sync FAILED after ${attempts} attempts\n` +
    `Error: ${errorMessage}`;

  await sendNotification(message);
}

module.exports = { sendNotification, notifySuccess, notifyFailure };
