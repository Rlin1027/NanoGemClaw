/**
 * Webhook Notification Service
 * 
 * Sends system events to external services (Slack, Discord, IFTTT, etc.)
 * via HTTP POST requests.
 */

import { WEBHOOK } from './config.js';
import { logger } from './logger.js';

interface WebhookPayload {
    event: string;
    message: string;
    timestamp: string;
    data?: any;
}

/**
 * Send a notification to the configured webhook URL.
 */
export async function sendWebhookNotification(
    event: string,
    message: string,
    data?: any,
): Promise<void> {
    if (!WEBHOOK.ENABLED || !WEBHOOK.URL) {
        return;
    }

    // Validate webhook URL format
    if (!WEBHOOK.URL.startsWith('http://') && !WEBHOOK.URL.startsWith('https://')) {
        logger.warn({ url: WEBHOOK.URL }, 'Invalid webhook URL scheme, skipping');
        return;
    }

    // Check if event is enabled
    if (!WEBHOOK.EVENTS.includes(event) && !WEBHOOK.EVENTS.includes('*')) {
        return;
    }

    const payload: WebhookPayload = {
        event,
        message,
        timestamp: new Date().toISOString(),
        data,
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(WEBHOOK.URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Webhook failed with status ${response.status}`);
        }

        logger.info({ event }, 'Webhook notification sent');
    } catch (err) {
        logger.error({ err, event }, 'Failed to send webhook notification');
    }
}
