/**
 * Tests for google-auth/token-manager.ts
 * ~22 tests covering encryption, file I/O, loadCredentials, exchangeCode,
 * hasClientCredentials, createOAuth2Client singleton, revokeTokens
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.hoisted(() => vi.fn());
const mockSetCredentials = vi.hoisted(() => vi.fn());
const mockRefreshAccessToken = vi.hoisted(() => vi.fn());
const mockRevokeToken = vi.hoisted(() => vi.fn());
const mockOn = vi.hoisted(() => vi.fn());

// Capture the mock OAuth2Client constructor so we can inspect instances.
// Must use `function` keyword — arrow functions cannot be used with `new`.
const MockOAuth2Client = vi.hoisted(() =>
  vi.fn().mockImplementation(function () {
    return {
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
      refreshAccessToken: mockRefreshAccessToken,
      revokeToken: mockRevokeToken,
      on: mockOn,
      credentials: { access_token: 'test-token' },
    };
  }),
);

vi.mock('google-auth-library', () => ({
  OAuth2Client: MockOAuth2Client,
}));

// ---------------------------------------------------------------------------
// fs mock — controlled in each test
// ---------------------------------------------------------------------------

const mockFsExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockFsReadFileSync = vi.hoisted(() => vi.fn());
const mockFsWriteFileSync = vi.hoisted(() => vi.fn());
const mockFsMkdirSync = vi.hoisted(() => vi.fn());
const mockFsUnlinkSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => {
  const mod = {
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
    writeFileSync: mockFsWriteFileSync,
    mkdirSync: mockFsMkdirSync,
    unlinkSync: mockFsUnlinkSync,
  };
  return { default: mod, ...mod };
});

// ---------------------------------------------------------------------------
// os mock
// ---------------------------------------------------------------------------

vi.mock('os', () => {
  const mod = {
    hostname: vi.fn().mockReturnValue('test-host'),
    userInfo: vi.fn().mockReturnValue({ username: 'test-user' }),
  };
  return { default: mod, ...mod };
});

// Import module under test AFTER setting up mocks
import {
  hasClientCredentials,
  createOAuth2Client,
  getOAuth2Client,
  isAuthenticated,
  loadCredentials,
  exchangeCode,
  revokeTokens,
} from '../token-manager.js';

// ============================================================================
// Setup/teardown
// ============================================================================

beforeEach(async () => {
  // Reset env vars
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_TOKEN_SECRET;

  vi.clearAllMocks();

  // vi.clearAllMocks() wipes mockImplementation — restore the constructor mock.
  // Must use `function` keyword so `new MockOAuth2Client()` works.
  MockOAuth2Client.mockImplementation(function () {
    return {
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
      refreshAccessToken: mockRefreshAccessToken,
      revokeToken: mockRevokeToken,
      on: mockOn,
      credentials: { access_token: 'test-token' },
    };
  });

  mockFsExistsSync.mockReturnValue(false);

  // Reset module-level singleton state by calling revokeTokens after each test
  // revokeToken on a fresh client is a no-op
  mockRevokeToken.mockResolvedValue(undefined);
});

afterEach(async () => {
  try {
    await revokeTokens();
  } catch {
    // ignore cleanup errors
  }
});

// ============================================================================
// hasClientCredentials
// ============================================================================

describe('hasClientCredentials', () => {
  it('returns false when both env vars are missing', () => {
    expect(hasClientCredentials()).toBe(false);
  });

  it('returns false when only GOOGLE_CLIENT_ID is set', () => {
    process.env.GOOGLE_CLIENT_ID = 'id-only';
    expect(hasClientCredentials()).toBe(false);
  });

  it('returns false when only GOOGLE_CLIENT_SECRET is set', () => {
    process.env.GOOGLE_CLIENT_SECRET = 'secret-only';
    expect(hasClientCredentials()).toBe(false);
  });

  it('returns true when both env vars are set', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    expect(hasClientCredentials()).toBe(true);
  });
});

// ============================================================================
// createOAuth2Client — singleton pattern
// ============================================================================

describe('createOAuth2Client', () => {
  beforeEach(async () => {
    // Ensure singleton is cleared between tests
    await revokeTokens();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  });

  it('throws when credentials are missing', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(() => createOAuth2Client()).toThrow('GOOGLE_CLIENT_ID');
  });

  it('creates an OAuth2Client with provided credentials', () => {
    const client = createOAuth2Client();
    expect(MockOAuth2Client).toHaveBeenCalledWith('client-id', 'client-secret');
    expect(client).toBeDefined();
  });

  it('returns the same instance on repeated calls (singleton)', () => {
    const first = createOAuth2Client();
    const second = createOAuth2Client();
    expect(first).toBe(second);
  });
});

// ============================================================================
// getOAuth2Client
// ============================================================================

describe('getOAuth2Client', () => {
  it('returns null when not authenticated', async () => {
    await revokeTokens();
    expect(getOAuth2Client()).toBeNull();
  });
});

// ============================================================================
// loadCredentials
// ============================================================================

describe('loadCredentials', () => {
  beforeEach(async () => {
    await revokeTokens();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  });

  it('returns false when client credentials are missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const result = await loadCredentials();
    expect(result).toBe(false);
  });

  it('returns false when token file does not exist', async () => {
    mockFsExistsSync.mockReturnValue(false);
    const result = await loadCredentials();
    expect(result).toBe(false);
  });

  it('returns false when stored token has no refresh_token', async () => {
    mockFsExistsSync.mockReturnValue(true);
    // plain-text JSON (legacy), no refresh_token
    const tokenJson = JSON.stringify({ access_token: 'at' });
    mockFsReadFileSync.mockReturnValue(Buffer.from(tokenJson));
    const result = await loadCredentials();
    expect(result).toBe(false);
  });

  it('forces a refresh when access token is expired', async () => {
    const expiredTokens = {
      access_token: 'old-at',
      refresh_token: 'rt',
      expiry_date: Date.now() - 1000, // 1 second in the past
    };
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(Buffer.from(JSON.stringify(expiredTokens)));
    mockRefreshAccessToken.mockResolvedValue({
      credentials: { access_token: 'new-at', expiry_date: Date.now() + 3600_000 },
    });

    const result = await loadCredentials();
    expect(result).toBe(true);
    expect(mockRefreshAccessToken).toHaveBeenCalled();
  });

  it('returns false (and sets authenticated=false) when refresh fails', async () => {
    const expiredTokens = {
      access_token: 'old-at',
      refresh_token: 'rt',
      expiry_date: Date.now() - 1000,
    };
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(Buffer.from(JSON.stringify(expiredTokens)));
    mockRefreshAccessToken.mockRejectedValue(new Error('Token revoked'));

    const result = await loadCredentials();
    expect(result).toBe(false);
    expect(isAuthenticated()).toBe(false);
  });

  it('auto-migrates legacy plain-text JSON to encrypted format', async () => {
    const plainTokens = { access_token: 'at', refresh_token: 'rt' };
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(Buffer.from(JSON.stringify(plainTokens)));

    await loadCredentials();
    // saveTokensToDisk (which calls writeFileSync) should have been called for migration
    expect(mockFsWriteFileSync).toHaveBeenCalled();
  });
});

// ============================================================================
// exchangeCode
// ============================================================================

describe('exchangeCode', () => {
  beforeEach(async () => {
    await revokeTokens();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  });

  it('throws when getToken returns no refresh_token', async () => {
    mockGetToken.mockResolvedValue({ tokens: { access_token: 'at' } });
    await expect(exchangeCode('auth-code', 'http://localhost/cb')).rejects.toThrow(
      'No refresh_token received',
    );
  });

  it('succeeds and marks authenticated when refresh_token is present', async () => {
    mockGetToken.mockResolvedValue({
      tokens: { access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3600_000 },
    });
    await exchangeCode('auth-code', 'http://localhost/cb');
    expect(isAuthenticated()).toBe(true);
  });

  it('calls setCredentials with the returned tokens', async () => {
    const tokens = { access_token: 'at', refresh_token: 'rt' };
    mockGetToken.mockResolvedValue({ tokens });
    await exchangeCode('code', 'http://localhost/cb');
    expect(mockSetCredentials).toHaveBeenCalledWith(tokens);
  });
});

// ============================================================================
// revokeTokens
// ============================================================================

describe('revokeTokens', () => {
  beforeEach(async () => {
    await revokeTokens();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  });

  it('sets isAuthenticated to false', async () => {
    mockGetToken.mockResolvedValue({
      tokens: { access_token: 'at', refresh_token: 'rt' },
    });
    await exchangeCode('code', 'http://localhost/cb');
    expect(isAuthenticated()).toBe(true);

    await revokeTokens();
    expect(isAuthenticated()).toBe(false);
  });

  it('deletes the token file when it exists', async () => {
    mockFsExistsSync.mockReturnValue(true);
    await revokeTokens();
    expect(mockFsUnlinkSync).toHaveBeenCalled();
  });

  it('does not call unlinkSync when the token file does not exist', async () => {
    mockFsExistsSync.mockReturnValue(false);
    await revokeTokens();
    expect(mockFsUnlinkSync).not.toHaveBeenCalled();
  });

  it('clears the singleton so createOAuth2Client makes a new instance next time', async () => {
    const first = createOAuth2Client();
    await revokeTokens();
    MockOAuth2Client.mockClear();
    const second = createOAuth2Client();
    // A new constructor call should have happened
    expect(MockOAuth2Client).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
  });
});

// ============================================================================
// encrypt / decrypt roundtrip
// ============================================================================

describe('encrypt/decrypt roundtrip via saveTokensToDisk → readTokensFromDisk', () => {
  it('encrypts then decrypts credentials correctly (via loadCredentials with non-expired token)', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';

    // Simulate a non-expired token stored as encrypted bytes on disk.
    // We do this by having exchangeCode write to disk (via mocked writeFileSync),
    // then capturing what was written and feeding it back to readFileSync.
    let writtenBuffer: Buffer | null = null;
    mockFsWriteFileSync.mockImplementation((_path: string, data: unknown) => {
      writtenBuffer = data as Buffer;
    });

    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'at',
        refresh_token: 'rt',
        expiry_date: Date.now() + 3600_000,
      },
    });

    await revokeTokens();
    await exchangeCode('code', 'http://localhost/cb');

    // writtenBuffer should now hold the encrypted token
    expect(writtenBuffer).not.toBeNull();

    // Reset and simulate loading from disk
    await revokeTokens();
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(writtenBuffer!);

    const result = await loadCredentials();
    expect(result).toBe(true);
  });

  it('saves tokens with 0o600 file permissions', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';

    mockGetToken.mockResolvedValue({
      tokens: { access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3600_000 },
    });

    await revokeTokens();
    await exchangeCode('code', 'http://localhost/cb');

    // writeFileSync is called with options including mode: 0o600
    const calls = mockFsWriteFileSync.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall[2]).toMatchObject({ mode: 0o600 });
  });
});
