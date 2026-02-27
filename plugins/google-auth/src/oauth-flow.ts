/**
 * OAuth2 Authorization Flow
 *
 * Starts a temporary localhost HTTP server to receive the Google OAuth
 * redirect callback. This avoids modifying the main Express server's
 * auth middleware and follows Google's recommended Desktop app flow.
 */

import http from 'http';
import { URL } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthFlowResult {
  code: string;
  redirectUri: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activeServer: http.Server | null = null;
let flowResolve: ((result: OAuthFlowResult) => void) | null = null;
let flowReject: ((err: Error) => void) | null = null;
let flowTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a temporary HTTP server to receive the OAuth2 callback.
 *
 * 1. Caller starts the server (returns a Promise that resolves with the auth code)
 * 2. Caller reads `getCallbackPort()` to build the auth URL
 * 3. User authorizes in browser → Google redirects to localhost
 * 4. Server captures code → Promise resolves → server shuts down
 *
 * Times out after 5 minutes.
 */
export function startOAuthCallbackServer(): Promise<OAuthFlowResult> {
  // Clean up any previous server
  stopCallbackServer();

  return new Promise<OAuthFlowResult>((resolve, reject) => {
    flowResolve = resolve;
    flowReject = reject;

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url!, 'http://localhost');

        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderPage(false, error));
          const rejectFn = flowReject;
          stopCallbackServer(false);
          rejectFn?.(new Error(`OAuth authorization denied: ${error}`));
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderPage(false, 'No authorization code received'));
          const rejectFn = flowReject;
          stopCallbackServer(false);
          rejectFn?.(new Error('No authorization code in callback'));
          return;
        }

        const port = (server.address() as { port: number }).port;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderPage(true));
        const resolveFn = flowResolve;
        stopCallbackServer(false);

        resolveFn?.({
          code,
          redirectUri: `http://localhost:${port}/oauth2callback`,
        });
      } catch (err) {
        const rejectFn = flowReject;
        stopCallbackServer(false);
        rejectFn?.(err instanceof Error ? err : new Error(String(err)));
      }
    });

    activeServer = server;

    // 5-minute timeout
    flowTimer = setTimeout(
      () => {
        const rejectFn = flowReject;
        stopCallbackServer(false);
        rejectFn?.(new Error('OAuth flow timed out after 5 minutes'));
      },
      5 * 60 * 1000,
    );

    server.on('error', (err) => {
      const rejectFn = flowReject;
      stopCallbackServer(false);
      rejectFn?.(err);
    });

    // Listen on a random available port, localhost only.
    // Using the 'listening' event avoids the race condition of a setTimeout
    // that could fire before the server is actually bound.
    server.listen(0, '127.0.0.1');
  });
}

/**
 * Get the port of the active callback server, or null if not running.
 */
export function getCallbackPort(): number | null {
  if (!activeServer) return null;
  const addr = activeServer.address();
  return addr && typeof addr !== 'string' ? addr.port : null;
}

/**
 * Stop the callback server if running.
 *
 * When called externally (not from the request handler), any pending OAuth
 * promise is rejected to prevent a promise leak.  Internal callers (the
 * request handler paths) pass `rejectPending = false` because they resolve
 * or reject the promise themselves immediately after calling this function.
 */
export function stopCallbackServer(rejectPending = true): void {
  if (flowTimer) {
    clearTimeout(flowTimer);
    flowTimer = null;
  }
  if (activeServer) {
    activeServer.close();
    activeServer = null;
  }
  if (rejectPending && flowReject) {
    flowReject(new Error('OAuth callback server stopped'));
  }
  flowResolve = null;
  flowReject = null;
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage(success: boolean, errorMsg?: string): string {
  const title = success ? 'Authorization Successful' : 'Authorization Failed';
  const heading = success ? 'Google Account Connected' : 'Authorization Failed';
  const body = success
    ? 'NanoGemClaw is now connected to your Google account. You can close this window.'
    : `${escapeHtml(errorMsg || 'Unknown error')}. Please try again from the dashboard.`;
  const color = success ? '#4ade80' : '#f87171';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>NanoGemClaw - ${title}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; display: flex;
         justify-content: center; align-items: center; min-height: 100vh;
         margin: 0; background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 2.5rem; border-radius: 1rem;
          background: #1e293b; max-width: 420px; box-shadow: 0 4px 24px rgba(0,0,0,.3); }
  h2 { color: ${color}; margin: 0 0 0.75rem; }
  p { color: #94a3b8; line-height: 1.5; margin: 0; }
</style></head>
<body><div class="card"><h2>${heading}</h2><p>${body}</p></div></body></html>`;
}
