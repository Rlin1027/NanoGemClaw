/**
 * Tests for google-auth/oauth-flow.ts
 * ~14 tests covering the localhost OAuth callback server
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';

import {
  startOAuthCallbackServer,
  getCallbackPort,
  stopCallbackServer,
} from '../oauth-flow.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Send an HTTP GET request to the local callback server.
 */
function sendRequest(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

// ============================================================================
// Setup/teardown
// ============================================================================

beforeEach(() => {
  // Ensure no leftover server from a previous test
  stopCallbackServer();
});

afterEach(() => {
  stopCallbackServer();
});

// ============================================================================
// Server lifecycle
// ============================================================================

describe('startOAuthCallbackServer — lifecycle', () => {
  it('starts a server that is accessible on a random port', async () => {
    const promise = startOAuthCallbackServer();
    // Give the server a moment to bind
    await new Promise((r) => setImmediate(r));

    const port = getCallbackPort();
    expect(port).not.toBeNull();
    expect(typeof port).toBe('number');
    expect(port!).toBeGreaterThan(0);

    // Clean up — attach rejection handler before stopping to avoid unhandled rejection
    const caught = promise.catch(() => {});
    stopCallbackServer();
    await caught;
    await expect(promise).rejects.toThrow('stopped');
  });

  it('getCallbackPort returns null when no server is running', () => {
    expect(getCallbackPort()).toBeNull();
  });

  it('cleans up a previous server when called again', async () => {
    const p1 = startOAuthCallbackServer();
    // Attach handler immediately to avoid unhandled rejection
    const p1caught = p1.catch(() => {});
    await new Promise((r) => setImmediate(r));

    const p2 = startOAuthCallbackServer();
    const p2caught = p2.catch(() => {});
    await new Promise((r) => setImmediate(r));

    const port2 = getCallbackPort();
    expect(port2).not.toBeNull();

    // p1 should have been rejected when p2 started
    await p1caught;
    await expect(p1).rejects.toBeDefined();

    stopCallbackServer();
    await p2caught;
    await expect(p2).rejects.toBeDefined();
  });
});

// ============================================================================
// Successful callback
// ============================================================================

describe('startOAuthCallbackServer — success path', () => {
  it('resolves with code and redirectUri when /oauth2callback?code=X is hit', async () => {
    const promise = startOAuthCallbackServer();
    await new Promise((r) => setImmediate(r));

    const port = getCallbackPort()!;
    await sendRequest(port, '/oauth2callback?code=test-auth-code');

    const result = await promise;
    expect(result.code).toBe('test-auth-code');
    expect(result.redirectUri).toContain('/oauth2callback');
    expect(result.redirectUri).toContain(`${port}`);
  });

  it('returns 200 HTML response on successful callback', async () => {
    const promise = startOAuthCallbackServer();
    await new Promise((r) => setImmediate(r));

    const port = getCallbackPort()!;
    const { status, body } = await sendRequest(port, '/oauth2callback?code=abc');

    expect(status).toBe(200);
    expect(body).toContain('Authorization Successful');

    await promise; // drain promise
  });

  it('server closes after receiving the callback', async () => {
    const promise = startOAuthCallbackServer();
    await new Promise((r) => setImmediate(r));

    const port = getCallbackPort()!;
    await sendRequest(port, '/oauth2callback?code=abc');
    await promise;

    // Server should now be gone
    expect(getCallbackPort()).toBeNull();
  });
});

// ============================================================================
// Error callback
// ============================================================================

describe('startOAuthCallbackServer — error path', () => {
  it('rejects with an error when /oauth2callback?error=access_denied is hit', async () => {
    const promise = startOAuthCallbackServer();
    // Attach rejection handler BEFORE the HTTP request triggers the rejection
    const rejection = expect(promise).rejects.toThrow('access_denied');
    await new Promise((r) => setImmediate(r));

    const port = getCallbackPort()!;
    await sendRequest(port, '/oauth2callback?error=access_denied');

    await rejection;
  });

  it('returns 200 with failure HTML on error callback', async () => {
    const promise = startOAuthCallbackServer();
    // Attach handler before sending the request to prevent unhandled rejection
    const caught = promise.catch(() => {});
    await new Promise((r) => setImmediate(r));

    const port = getCallbackPort()!;
    const { status, body } = await sendRequest(port, '/oauth2callback?error=some_error');

    expect(status).toBe(200);
    expect(body).toContain('Authorization Failed');

    await caught;
  });

  it('HTML-escapes XSS in error parameter', async () => {
    const promise = startOAuthCallbackServer();
    const caught = promise.catch(() => {});
    await new Promise((r) => setImmediate(r));

    const port = getCallbackPort()!;
    const xssPayload = encodeURIComponent('<script>alert(1)</script>');
    const { body } = await sendRequest(port, `/oauth2callback?error=${xssPayload}`);

    // Raw <script> tag must not appear in the rendered HTML
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');

    await caught;
  });

  it('returns 404 for unrecognized paths', async () => {
    const promise = startOAuthCallbackServer();
    const caught = promise.catch(() => {});
    await new Promise((r) => setImmediate(r));

    const port = getCallbackPort()!;
    const { status } = await sendRequest(port, '/unknown-path');
    expect(status).toBe(404);

    stopCallbackServer();
    await caught;
  });
});

// ============================================================================
// 5-minute timeout
// ============================================================================

describe('startOAuthCallbackServer — 5-minute timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects after 5 minutes with a timeout error', async () => {
    const promise = startOAuthCallbackServer();
    // Attach rejection handler BEFORE advancing time so the rejection is not unhandled
    const rejection = expect(promise).rejects.toThrow('timed out');

    // Advance past the 5-minute timeout
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

    await rejection;
  });

  it('getCallbackPort returns null after timeout fires', async () => {
    const promise = startOAuthCallbackServer();
    const caught = promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    await caught;

    expect(getCallbackPort()).toBeNull();
  });
});

// ============================================================================
// stopCallbackServer
// ============================================================================

describe('stopCallbackServer', () => {
  it('rejects the pending promise when called externally', async () => {
    const promise = startOAuthCallbackServer();
    // Attach handler before stop fires the rejection
    const rejection = expect(promise).rejects.toThrow();
    await new Promise((r) => setImmediate(r));

    stopCallbackServer();

    await rejection;
  });

  it('is idempotent — calling twice does not throw', () => {
    expect(() => {
      stopCallbackServer();
      stopCallbackServer();
    }).not.toThrow();
  });
});
