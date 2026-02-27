/**
 * Google Auth Plugin
 *
 * Provides OAuth2 authentication for all Google service plugins.
 * Other plugins depend on this to access Google APIs (Drive, Calendar, Tasks).
 *
 * Setup:
 *   1. Create OAuth2 credentials in Google Cloud Console (Desktop App type)
 *   2. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 *   3. Authorize via dashboard Settings → Google Account
 */

import type { NanoPlugin, PluginApi } from '@nanogemclaw/plugin-api';
import { Router } from 'express';
import {
    isAuthenticated,
    hasClientCredentials,
    loadCredentials,
    createOAuth2Client,
    exchangeCode,
    revokeTokens,
    getScopes,
} from './token-manager.js';
import {
    startOAuthCallbackServer,
    getCallbackPort,
    stopCallbackServer,
} from './oauth-flow.js';

// Re-export for other plugins
export { getOAuth2Client, isAuthenticated } from './token-manager.js';

let logger: PluginApi['logger'] | null = null;

const googleAuthPlugin: NanoPlugin = {
    id: 'google-auth',
    name: 'Google Auth',
    version: '0.1.0',
    description: 'OAuth2 authentication for Google services (Drive, Calendar, Tasks)',

    async init(api: PluginApi): Promise<void | false> {
        logger = api.logger;

        if (!hasClientCredentials()) {
            api.logger.warn(
                'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google Auth disabled. ' +
                    'Set these env vars and restart to enable Google integration.',
            );
            return false;
        }

        const restored = await loadCredentials();
        if (restored) {
            api.logger.info('Google Auth: restored saved credentials');
        } else {
            api.logger.info('Google Auth: awaiting authorization via dashboard');
        }
    },

    async stop(): Promise<void> {
        stopCallbackServer();
        logger?.info('Google Auth plugin stopped');
    },

    routes: [
        {
            prefix: '',
            createRouter(): Router {
                const router = Router();

                // ----- Status ---------------------------------------------------
                router.get('/status', (_req, res) => {
                    res.json({
                        data: {
                            authenticated: isAuthenticated(),
                            hasCredentials: hasClientCredentials(),
                            scopes: getScopes(),
                        },
                    });
                });

                // ----- Start OAuth flow -----------------------------------------
                router.post('/authorize', async (_req, res) => {
                    try {
                        if (isAuthenticated()) {
                            res.json({ data: { message: 'Already authenticated' } });
                            return;
                        }

                        if (!hasClientCredentials()) {
                            res.status(400).json({
                                error: 'Google OAuth credentials not configured',
                            });
                            return;
                        }

                        // Start temp callback server (non-blocking promise)
                        const flowPromise = startOAuthCallbackServer();

                        // Wait briefly for the server to bind
                        await new Promise((r) => setTimeout(r, 150));

                        const port = getCallbackPort();
                        if (!port) {
                            res.status(500).json({
                                error: 'Failed to start OAuth callback server',
                            });
                            return;
                        }

                        const redirectUri = `http://localhost:${port}/oauth2callback`;
                        const client = createOAuth2Client();
                        const authUrl = client.generateAuthUrl({
                            access_type: 'offline',
                            scope: getScopes(),
                            prompt: 'consent',
                            redirect_uri: redirectUri,
                        });

                        // Return URL immediately — exchange happens in background
                        res.json({ data: { authUrl } });

                        // Await callback then exchange code
                        try {
                            const { code, redirectUri: cbUri } = await flowPromise;
                            await exchangeCode(code, cbUri);
                            logger?.info('Google Auth: authorization completed');
                        } catch (err) {
                            logger?.error(
                                `Google Auth: authorization flow failed — ${err}`,
                            );
                        }
                    } catch {
                        res.status(500).json({
                            error: 'Failed to start authorization flow',
                        });
                    }
                });

                // ----- Revoke ---------------------------------------------------
                router.post('/revoke', async (_req, res) => {
                    try {
                        await revokeTokens();
                        res.json({
                            data: { message: 'Google account disconnected' },
                        });
                    } catch {
                        res.status(500).json({
                            error: 'Failed to revoke authorization',
                        });
                    }
                });

                return router;
            },
        },
    ],
};

export default googleAuthPlugin;
