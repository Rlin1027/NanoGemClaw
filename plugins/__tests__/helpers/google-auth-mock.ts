/**
 * Shared Google Auth mocks — used by google-tasks, google-drive,
 * google-calendar-rw, and drive-knowledge-rag tests.
 *
 * Usage in test files:
 *   import { mockGetOAuth2Client, mockIsAuthenticated, setupGoogleAuthMock }
 *     from '../../../__tests__/helpers/google-auth-mock';
 *
 *   vi.mock('nanogemclaw-plugin-google-auth', () => ({
 *     getOAuth2Client: mockGetOAuth2Client,
 *     isAuthenticated: mockIsAuthenticated,
 *   }));
 */
import { vi } from 'vitest';

export const mockGetOAuth2Client = vi.fn();
export const mockIsAuthenticated = vi.fn().mockReturnValue(true);

/**
 * Configure the auth mock state.
 * @param authenticated - Whether to simulate an authenticated state.
 */
export function setupGoogleAuthMock(authenticated = true): void {
  mockIsAuthenticated.mockReturnValue(authenticated);
  if (authenticated) {
    mockGetOAuth2Client.mockReturnValue({
      credentials: { access_token: 'test-access-token' },
    });
  } else {
    mockGetOAuth2Client.mockReturnValue(null);
  }
}

export function resetGoogleAuthMock(): void {
  mockGetOAuth2Client.mockReset();
  mockIsAuthenticated.mockReset();
}
