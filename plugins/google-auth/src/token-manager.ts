/**
 * Google OAuth2 Token Manager
 *
 * Manages OAuth2 credentials for all Google service plugins.
 * Handles token storage, auto-refresh, and lifecycle.
 *
 * Other plugins import `getOAuth2Client()` to access Google APIs.
 */

import { OAuth2Client, type Credentials } from 'google-auth-library';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
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
      // Detect refresh_token rotation (Google sometimes issues a new one)
      if (
        newTokens.refresh_token &&
        existing?.refresh_token &&
        newTokens.refresh_token !== existing.refresh_token
      ) {
        console.info(
          'Google Auth: refresh_token rotated — persisting new token',
        );
      }
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

  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token received. Revoke access at https://myaccount.google.com/permissions and re-authorize.',
    );
  }

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
// Encryption helpers (AES-256-GCM)
//
// Derives a per-machine key from GOOGLE_TOKEN_SECRET env var (preferred)
// or a fallback seed based on hostname + username.  This is NOT a substitute
// for a proper secrets manager, but prevents tokens from sitting in plain
// text on disk.
// ---------------------------------------------------------------------------

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(): Buffer {
  const secret =
    process.env.GOOGLE_TOKEN_SECRET ??
    `nanogemclaw:${os.hostname()}:${os.userInfo().username}`;
  // Use a machine-specific salt so identical secrets on different hosts
  // produce different keys.  Falls back to a static salt when hostname
  // information is unavailable.
  const salt = `nanogemclaw:${os.hostname() || 'default'}`;
  return crypto.scryptSync(secret, salt, 32);
}

function encrypt(plaintext: string): Buffer {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Layout: [iv (12)] [tag (16)] [ciphertext (...)]
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data: Buffer): string {
  const key = deriveKey();
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = data.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf-8');
}

// ---------------------------------------------------------------------------
// Disk I/O (encrypted, owner-only permissions)
// ---------------------------------------------------------------------------

function readTokensFromDisk(): Credentials | null {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    const raw = fs.readFileSync(TOKEN_PATH);

    // Backwards-compat: try parsing as plain JSON first (pre-encryption tokens)
    if (raw[0] === 0x7b /* '{' */) {
      const tokens = JSON.parse(raw.toString('utf-8')) as Credentials;
      // Auto-migrate: re-save as encrypted so plain-text doesn't linger on disk
      try {
        saveTokensToDisk(tokens);
      } catch {
        // Migration is best-effort; don't block loading
      }
      return tokens;
    }

    // Encrypted format
    return JSON.parse(decrypt(raw));
  } catch {
    return null;
  }
}

function saveTokensToDisk(tokens: Credentials): void {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const encrypted = encrypt(JSON.stringify(tokens));
  fs.writeFileSync(TOKEN_PATH, encrypted, { mode: 0o600 });
}
