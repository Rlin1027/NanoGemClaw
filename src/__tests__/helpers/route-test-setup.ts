import express from 'express';
import { vi } from 'vitest';

/**
 * Create a minimal Express app for testing a router.
 * Mounts express.json() middleware and the given router at /api.
 */
export function createTestApp(router: express.Router): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

/**
 * Common mock dependencies factory.
 * Returns vi.fn() mocks for shared deps used across routers.
 */
export function createMockDeps() {
  return {
    validateFolder: vi.fn((folder: string) => /^[a-zA-Z0-9_-]+$/.test(folder)),
    validateNumericParam: vi.fn((value: string, _name: string) => {
      const num = parseInt(value, 10);
      return isNaN(num) || num < 0 ? null : num;
    }),
    emitDashboardEvent: vi.fn(),
  };
}
