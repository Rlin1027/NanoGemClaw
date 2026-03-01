import type { NanoPlugin, PluginApi } from '@nanogemclaw/plugin-api';
import { MemorizationService } from './memorization.js';

let service: MemorizationService | null = null;

const memorizationPlugin: NanoPlugin = {
  id: 'memorization-service',
  name: 'Memorization Service',
  version: '0.1.0',
  description:
    'Automatic conversation summarization based on message count thresholds and time-based debounce',

  async init(api: PluginApi): Promise<void> {
    service = new MemorizationService(api);
    service.initTable();
    api.logger.info('Memorization plugin initialized');
  },

  async start(api: PluginApi): Promise<void> {
    if (!service) return;
    await service.start();

    // Phase 2: Connect to Event Bus if available
    if (api.eventBus) {
      service.subscribeToEvents(api.eventBus);
      api.logger.info('Memorization service subscribed to Event Bus');
    }
  },

  async stop(_api: PluginApi): Promise<void> {
    if (service) {
      await service.stop();
      service = null;
    }
  },
};

export default memorizationPlugin;
