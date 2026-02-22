/**
 * NanoGemClaw Configuration Example
 *
 * Copy this file to nanogemclaw.config.ts and customize as needed.
 * This file is optional — all settings can also be controlled via environment variables.
 */

import type { NanoPlugin } from '@nanogemclaw/plugin-api';

export interface NanoGemClawConfig {
  /**
   * List of plugins to load.
   * Plugins are initialized in order.
   */
  plugins?: NanoPlugin[];

  /**
   * Assistant display name (overrides ASSISTANT_NAME env var).
   * Used to trigger responses in group chats: @Andy
   */
  assistantName?: string;

  /**
   * Default Gemini model for all groups (overrides GEMINI_MODEL env var).
   * Can be overridden per-group from the dashboard.
   */
  defaultModel?: string;
}

const config: NanoGemClawConfig = {
  assistantName: 'Andy',
  defaultModel: 'gemini-3-flash-preview',

  plugins: [
    // Add your plugins here. Example:
    // new WeatherPlugin({ apiKey: process.env.WEATHER_API_KEY }),
    // new ReminderPlugin(),
  ],
};

export default config;
