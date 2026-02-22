import { Router } from 'express';
import { logger, setLogLevel } from '@nanogemclaw/core/logger';

interface ConfigRouterDeps {
  dashboardHost: string;
  dashboardPort: number;
  getConnectedClients: () => number;
  accessCode: string | undefined;
}

export function createConfigRouter(deps: ConfigRouterDeps): Router {
  const router = Router();
  const { dashboardHost, dashboardPort, getConnectedClients, accessCode } = deps;

  // GET /api/health
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // GET /api/config
  router.get('/config', async (_req, res) => {
    try {
      const { isMaintenanceMode } = await import('../../../../src/maintenance.js');
      const currentLogLevel = process.env.LOG_LEVEL || 'info';

      res.json({
        data: {
          maintenanceMode: isMaintenanceMode(),
          logLevel: currentLogLevel,
          dashboardHost,
          dashboardPort,
          uptime: process.uptime(),
          connectedClients: getConnectedClients(),
          authRequired: !!accessCode,
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch config' });
    }
  });

  // PUT /api/config
  router.put('/config', async (req, res) => {
    try {
      const { maintenanceMode, logLevel } = req.body;
      const { setMaintenanceMode, isMaintenanceMode } =
        await import('../../../../src/maintenance.js');

      if (typeof maintenanceMode === 'boolean') {
        setMaintenanceMode(maintenanceMode);
        logger.info({ maintenanceMode }, 'Maintenance mode updated via dashboard');
      }

      if (typeof logLevel === 'string') {
        setLogLevel(logLevel);
        process.env.LOG_LEVEL = logLevel;
        logger.info({ logLevel }, 'Log level updated via dashboard');
      }

      res.json({
        data: {
          maintenanceMode: isMaintenanceMode(),
          logLevel: process.env.LOG_LEVEL || 'info',
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  // GET /api/config/cache-stats
  router.get('/config/cache-stats', async (_req, res) => {
    try {
      const { getCacheStats } = await import('../../../../src/context-cache.js');
      const { isGeminiClientAvailable } = await import('../../../../src/gemini-client.js');
      const { FAST_PATH } = await import('../../../../src/config.js');

      res.json({
        data: {
          fastPathEnabled: FAST_PATH.ENABLED,
          geminiClientAvailable: isGeminiClientAvailable(),
          ...getCacheStats(),
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch cache stats' });
    }
  });

  // GET /api/config/secrets
  router.get('/config/secrets', (_req, res) => {
    const secretKeys = [
      'GEMINI_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'WEBHOOK_URL',
      'DASHBOARD_API_KEY',
    ];

    const secrets = secretKeys.map((key) => {
      const value = process.env[key];
      return {
        key,
        configured: !!value,
      };
    });

    res.json({ data: secrets });
  });

  return router;
}
