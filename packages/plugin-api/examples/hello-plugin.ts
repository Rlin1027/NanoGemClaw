/**
 * Example NanoGemClaw Plugin: Hello Plugin
 *
 * This is a minimal plugin skeleton demonstrating the NanoPlugin interface.
 * Copy and rename this file to build your own plugin.
 *
 * Usage:
 *   1. Copy this file to your project
 *   2. Implement the methods you need
 *   3. Add it to nanogemclaw.config.ts plugins array
 */

import type { NanoPlugin, PluginApi, GeminiToolContribution } from '../src/index.js';

export class HelloPlugin implements NanoPlugin {
  id = 'hello-plugin';
  name = 'Hello Plugin';
  version = '1.0.0';
  description = 'A minimal example plugin that greets users';

  private api!: PluginApi;

  /**
   * Called during initialization (DB setup, config loading, etc.)
   * Return false to abort plugin loading.
   */
  async init(api: PluginApi): Promise<void> {
    this.api = api;
    api.logger.info('Hello Plugin initialized');
  }

  /**
   * Called after bot is connected and ready.
   */
  async start(api: PluginApi): Promise<void> {
    api.logger.info('Hello Plugin started');
  }

  /**
   * Called during graceful shutdown.
   */
  async stop(api: PluginApi): Promise<void> {
    api.logger.info('Hello Plugin stopped');
  }

  /**
   * Gemini function-calling tools provided by this plugin.
   * These are exposed as native Gemini tools in every group.
   */
  geminiTools: GeminiToolContribution[] = [
    {
      name: 'hello',
      description: 'Greet a user by name',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the person to greet',
          },
        },
        required: ['name'],
      },
      permission: 'any',
      execute: async (args) => {
        return `Hello, ${args.name}! Nice to meet you.`;
      },
    },
  ];
}
