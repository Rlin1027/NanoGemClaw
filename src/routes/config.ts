import { Router } from 'express';
import { logger, setLogLevel } from '../logger.js';
import { validate } from '../middleware/validate.js';
import { configUpdateBody } from '../schemas/config-routes.js';

interface ConfigRouterDeps {
  dashboardHost: string;
  dashboardPort: number;
  getConnectedClients: () => number;
  accessCode: string | undefined;
}

export function createConfigRouter(deps: ConfigRouterDeps): Router {
  const router = Router();
  const { dashboardHost, dashboardPort, getConnectedClients, accessCode } =
    deps;

  // GET /api/health
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // GET /api/config
  router.get('/config', async (_req, res) => {
    try {
      const { isMaintenanceMode } = await import('../maintenance.js');
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
  router.put(
    '/config',
    validate({ body: configUpdateBody }),
    async (req, res) => {
      try {
        const { maintenanceMode, logLevel } = req.body;
        const { setMaintenanceMode, isMaintenanceMode } =
          await import('../maintenance.js');

        if (typeof maintenanceMode === 'boolean') {
          setMaintenanceMode(maintenanceMode);
          logger.info(
            { maintenanceMode },
            'Maintenance mode updated via dashboard',
          );
        }

        if (typeof logLevel === 'string') {
          setLogLevel(logLevel);
          // Update process.env so GET /api/config reflects the change
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
    },
  );

  // GET /api/config/scheduler - Scheduler concurrency info
  router.get('/config/scheduler', async (_req, res) => {
    try {
      const os = await import('os');
      const { SCHEDULER } = await import('../config.js');

      res.json({
        data: {
          concurrency: SCHEDULER.CONCURRENCY,
          recommended: SCHEDULER.getRecommendedConcurrency(),
          cpuCores: os.default.cpus().length,
          totalMemoryGB: +(os.default.totalmem() / 1024 ** 3).toFixed(1),
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch scheduler info' });
    }
  });

  // GET /api/config/cache-stats - Context cache statistics
  router.get('/config/cache-stats', async (_req, res) => {
    try {
      const { getCacheStats } = await import('../context-cache.js');
      const { isGeminiClientAvailable } = await import('../gemini-client.js');
      const { FAST_PATH } = await import('../config.js');

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

  // GET /api/config/models — Available Gemini models
  router.get('/config/models', async (_req, res) => {
    try {
      const { getAvailableModels } = await import('@nanogemclaw/gemini');
      const { getDefaultModel } = await import('../config.js');
      const { resolveAuth, discoverVertexModels } = await import('../auth.js');

      let models = getAvailableModels();

      // If OAuth and cache is only fallback, try refreshing from Vertex AI
      const auth = await resolveAuth();
      if (auth?.type === 'oauth' && models.length > 0) {
        const { setExternalModels } = await import('@nanogemclaw/gemini');
        const vertexModels = await discoverVertexModels(auth.token, auth.project);
        if (vertexModels.length > 0) {
          setExternalModels(vertexModels);
          models = vertexModels;
        }
      }

      res.json({
        data: {
          models,
          defaultModel: getDefaultModel(),
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch available models' });
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
