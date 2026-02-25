/**
 * NanoGemClaw Plugin Skeleton
 *
 * This is a minimal example plugin demonstrating the NanoPlugin interface.
 * Copy this directory, rename it, and customize to build your own plugin.
 *
 * To use this plugin, either:
 * 1. Place it in the plugins/ directory (auto-discovered if package.json lists
 *    @nanogemclaw/plugin-api as a dependency), OR
 * 2. Register it manually in data/plugins.json:
 *    {
 *      "plugins": [
 *        {
 *          "source": "./path/to/your-plugin/src/index.ts",
 *          "config": { "greeting": "Hello" },
 *          "enabled": true
 *        }
 *      ]
 *    }
 */

import type {
  NanoPlugin,
  PluginApi,
  GeminiToolContribution,
  ToolExecutionContext,
  MessageHookContext,
} from '@nanogemclaw/plugin-api';

// ============================================================================
// Plugin Definition
// ============================================================================

const examplePlugin: NanoPlugin = {
  id: 'example-plugin',
  name: 'Example Plugin',
  version: '0.1.0',
  description: 'A minimal example plugin for NanoGemClaw',

  // --------------------------------------------------------------------------
  // Lifecycle: init — called once at startup (DB migrations, config loading)
  // Return false to disable the plugin.
  // --------------------------------------------------------------------------
  async init(api: PluginApi): Promise<void> {
    api.logger.info('Example plugin initialized');
    api.logger.info(`Config: ${JSON.stringify(api.config)}`);
    // Example: create a plugin-specific data directory
    // fs.mkdirSync(path.join(api.dataDir, 'cache'), { recursive: true });
  },

  // --------------------------------------------------------------------------
  // Lifecycle: start — called after bot is connected and ready
  // --------------------------------------------------------------------------
  async start(api: PluginApi): Promise<void> {
    api.logger.info('Example plugin started');
    // Example: start a background polling service
    // this.pollInterval = setInterval(() => { ... }, 60_000);
  },

  // --------------------------------------------------------------------------
  // Lifecycle: stop — called during graceful shutdown
  // --------------------------------------------------------------------------
  async stop(api: PluginApi): Promise<void> {
    api.logger.info('Example plugin stopped');
    // Example: clear intervals, close connections
    // clearInterval(this.pollInterval);
  },

  // --------------------------------------------------------------------------
  // Gemini Function Calling Tools
  // These appear in the model's tool list and can be called by Gemini.
  // --------------------------------------------------------------------------
  geminiTools: [
    {
      name: 'example_greet',
      description: 'Send a greeting message. Use when the user asks to be greeted.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: {
            type: 'STRING',
            description: 'The name to greet',
          },
        },
        required: ['name'],
      },
      permission: 'any', // 'any' = all groups, 'main' = main group only

      async execute(
        args: Record<string, unknown>,
        context: ToolExecutionContext,
      ): Promise<string> {
        const greeting = `Hello, ${args.name}! Greetings from example-plugin.`;
        // Optionally send a message directly
        // await context.sendMessage(context.chatJid, greeting);
        return JSON.stringify({ success: true, message: greeting });
      },
    } satisfies GeminiToolContribution,
  ],

  // --------------------------------------------------------------------------
  // Message Lifecycle Hooks
  // --------------------------------------------------------------------------
  hooks: {
    // Called BEFORE message processing. Return { skip: true } to skip the message.
    // Return a string to override the message content.
    async beforeMessage(context: MessageHookContext): Promise<void | string | { skip: true }> {
      // Example: block messages containing a specific phrase
      // if (context.content.includes('badword')) {
      //   return { skip: true };
      // }
    },

    // Called AFTER a successful reply (fire-and-forget, for logging/analytics).
    async afterMessage(
      context: MessageHookContext & { reply: string },
    ): Promise<void> {
      // Example: log to external analytics service
      // await analytics.track({ chatJid: context.chatJid, reply: context.reply });
    },

    // Called when message processing throws an error. Return a fallback reply string.
    async onMessageError(
      context: MessageHookContext & { error: Error },
    ): Promise<void | string> {
      // Example: provide a custom error message
      // return `Sorry, something went wrong: ${context.error.message}`;
    },
  },
};

export default examplePlugin;
