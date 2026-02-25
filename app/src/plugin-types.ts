/**
 * App-layer plugin types — re-exports from @nanogemclaw/plugin-api
 * plus internal registry types used by the plugin loader.
 */

export type {
  NanoPlugin,
  PluginApi,
  PluginLogger,
  GeminiToolContribution,
  ToolExecutionContext,
  IpcHandlerContribution,
  RouteContribution,
  ServiceContribution,
  HookContributions,
  BeforeMessageHook,
  AfterMessageHook,
  OnMessageErrorHook,
  MessageHookContext,
  PluginRegistryEntry,
  PluginManifest,
  PluginOrigin,
  DiscoveredPlugin,
} from '@nanogemclaw/plugin-api';

export interface LoadedPlugin {
  plugin: import('@nanogemclaw/plugin-api').NanoPlugin;
  api: import('@nanogemclaw/plugin-api').PluginApi;
  config: Record<string, unknown>;
  enabled: boolean;
}
