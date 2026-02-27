/**
 * Google OAuth2 Token Manager
 *
 * Manages OAuth2 credentials for all Google service plugins.
 * Handles token storage, auto-refresh, and lifecycle.
 *
 * Other plugins import `getOAuth2Client()` to access Google APIs.
 */

import { OAuth2Client, type Credentials } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
];

const TOKEN_PATH = path.resolve(process.cwd(), 'store', 'google-auth.json');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let oauth2Client: OAuth2Client | null = null;
let _authenticated = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getScopes(): string[] {
  return [...SCOPES];
}

export function hasClientCredentials(): boolean {
  const id = process.env.GOOGLE_CLIENT_ID || '';
  const secret = process.env.GOOGLE_CLIENT_SECRET || '';
  return !!(id && secret);
}

/**
 * Create or return the singleton OAuth2Client.
 * Does NOT imply authentication — call `loadCredentials()` first.
 */
export function createOAuth2Client(): OAuth2Client {
  if (oauth2Client) return oauth2Client;

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required',
    );
  }

  oauth2Client = new OAuth2Client(clientId, clientSecret);

  // Persist refreshed tokens automatically
  oauth2Client.on('tokens', (newTokens) => {
    if (_authenticated) {
      const existing = readTokensFromDisk();
      saveTokensToDisk({ ...existing, ...newTokens });
    }
  });

  return oauth2Client;
}

/**
 * Get authenticated OAuth2Client for Google API calls.
 * Returns null if not yet authenticated.
 *
 * Usage in other plugins:
 * ```ts
 * import { getOAuth2Client } from 'nanogemclaw-plugin-google-auth';
 * const auth = getOAuth2Client();
 * if (!auth) throw new Error('Google not connected');
 * const tasks = google.tasks({ version: 'v1', auth });
 * ```
 */
export function getOAuth2Client(): OAuth2Client | null {
  if (!oauth2Client || !_authenticated) return null;
  return oauth2Client;
}

export function isAuthenticated(): boolean {
  return _authenticated;
}

/**
 * Exchange an authorization code for tokens and persist them.
 */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
  client.setCredentials(tokens);
  _authenticated = true;
  saveTokensToDisk(tokens as Credentials);
}

/**
 * Attempt to load previously stored tokens from disk.
 * Returns true if credentials were restored and verified.
 */
export async function loadCredentials(): Promise<boolean> {
  try {
    if (!hasClientCredentials()) return false;

    const tokens = readTokensFromDisk();
    if (!tokens?.refresh_token) return false;

    const client = createOAuth2Client();
    client.setCredentials(tokens);

    // If access_token is expired, force a refresh now to verify the refresh_token
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      saveTokensToDisk({ ...tokens, ...credentials } as Credentials);
    }

    _authenticated = true;
    return true;
  } catch {
    _authenticated = false;
    return false;
  }
}

/**
 * Revoke tokens and clear stored credentials.
 */
export async function revokeTokens(): Promise<void> {
  if (oauth2Client && _authenticated) {
    try {
      const creds = oauth2Client.credentials;
      if (creds.access_token) {
        await oauth2Client.revokeToken(creds.access_token);
      }
    } catch {
      // Token may already be invalid — ignore
    }
    oauth2Client.setCredentials({});
  }

  _authenticated = false;
  oauth2Client = null;

  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }
}

// ---------------------------------------------------------------------------
// Disk I/O (token file permissions: owner-only read/write)
// ---------------------------------------------------------------------------

function readTokensFromDisk(): Credentials | null {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTokensToDisk(tokens: Credentials): void {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}
