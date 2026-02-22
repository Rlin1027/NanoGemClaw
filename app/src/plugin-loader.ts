/**
 * Plugin Loader
 *
 * Loads, initializes, starts, and stops NanoPlugin instances.
 * Plugins are loaded from the plugin manifest at startup.
 */

import path from 'path';
import fs from 'fs';
import { logger } from '@nanogemclaw/core/logger';
import type { NanoPlugin, PluginApi, PluginManifest, PluginRegistryEntry } from '@nanogemclaw/plugin-api';
import type { LoadedPlugin } from './plugin-types.js';

// ============================================================================
// Registry
// ============================================================================

const loadedPlugins: LoadedPlugin[] = [];

// ============================================================================
// PluginApi factory
// ============================================================================

function createPluginApi(
  pluginId: string,
  config: Record<string, unknown>,
  dataDir: string,
  deps: {
    getDatabase(): unknown;
    sendMessage(chatJid: string, text: string): Promise<void>;
    getGroups(): Record<string, import('@nanogemclaw/core').RegisteredGroup>;
  },
): PluginApi {
  const pluginLogger = {
    info: (msg: string, ...args: unknown[]) => logger.info({ plugin: pluginId }, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => logger.warn({ plugin: pluginId }, msg, ...args),
    error: (msg: string, ...args: unknown[]) => logger.error({ plugin: pluginId }, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => logger.debug({ plugin: pluginId }, msg, ...args),
  };

  const pluginDataDir = path.join(dataDir, 'plugins', pluginId);
  fs.mkdirSync(pluginDataDir, { recursive: true });

  return {
    getDatabase: deps.getDatabase,
    sendMessage: deps.sendMessage,
    getGroups: deps.getGroups,
    logger: pluginLogger,
    config,
    dataDir: pluginDataDir,
  };
}

// ============================================================================
// Load plugins from manifest
// ============================================================================

export async function loadPlugins(
  manifestPath: string,
  deps: {
    getDatabase(): unknown;
    sendMessage(chatJid: string, text: string): Promise<void>;
    getGroups(): Record<string, import('@nanogemclaw/core').RegisteredGroup>;
    dataDir: string;
  },
): Promise<void> {
  if (!fs.existsSync(manifestPath)) {
    logger.debug({ manifestPath }, 'No plugin manifest found, skipping plugin load');
    return;
  }

  let manifest: PluginManifest;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(raw) as PluginManifest;
  } catch (err) {
    logger.error({ err, manifestPath }, 'Failed to parse plugin manifest');
    return;
  }

  for (const entry of manifest.plugins) {
    if (!entry.enabled) {
      logger.debug({ source: entry.source }, 'Plugin disabled, skipping');
      continue;
    }

    await loadPlugin(entry, deps);
  }

  logger.info({ count: loadedPlugins.length }, 'Plugins loaded');
}

async function loadPlugin(
  entry: PluginRegistryEntry,
  deps: {
    getDatabase(): unknown;
    sendMessage(chatJid: string, text: string): Promise<void>;
    getGroups(): Record<string, import('@nanogemclaw/core').RegisteredGroup>;
    dataDir: string;
  },
): Promise<void> {
  try {
    const mod = await import(entry.source);
    const plugin: NanoPlugin = mod.default ?? mod.plugin;

    if (!plugin || !plugin.id) {
      logger.warn({ source: entry.source }, 'Invalid plugin: missing id or default export');
      return;
    }

    const api = createPluginApi(plugin.id, entry.config, deps.dataDir, deps);

    loadedPlugins.push({
      plugin,
      api,
      config: entry.config,
      enabled: entry.enabled,
    });

    logger.info({ pluginId: plugin.id, source: entry.source }, 'Plugin loaded');
  } catch (err) {
    logger.error({ err, source: entry.source }, 'Failed to load plugin');
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

export async function initPlugins(): Promise<void> {
  for (const loaded of loadedPlugins) {
    if (!loaded.plugin.init) continue;
    try {
      const result = await loaded.plugin.init(loaded.api);
      if (result === false) {
        loaded.enabled = false;
        logger.warn({ pluginId: loaded.plugin.id }, 'Plugin init returned false, disabling');
      }
    } catch (err) {
      loaded.enabled = false;
      logger.error({ err, pluginId: loaded.plugin.id }, 'Plugin init failed, disabling');
    }
  }
}

export async function startPlugins(): Promise<void> {
  for (const loaded of loadedPlugins) {
    if (!loaded.enabled || !loaded.plugin.start) continue;
    try {
      await loaded.plugin.start(loaded.api);
      logger.info({ pluginId: loaded.plugin.id }, 'Plugin started');
    } catch (err) {
      logger.error({ err, pluginId: loaded.plugin.id }, 'Plugin start failed');
    }
  }
}

export async function stopPlugins(): Promise<void> {
  for (const loaded of [...loadedPlugins].reverse()) {
    if (!loaded.plugin.stop) continue;
    try {
      await loaded.plugin.stop(loaded.api);
      logger.info({ pluginId: loaded.plugin.id }, 'Plugin stopped');
    } catch (err) {
      logger.error({ err, pluginId: loaded.plugin.id }, 'Plugin stop failed');
    }
  }
}

// ============================================================================
// Accessors for other modules
// ============================================================================

export function getLoadedPlugins(): LoadedPlugin[] {
  return loadedPlugins.filter(p => p.enabled);
}

/**
 * Get all Gemini tool contributions from all enabled plugins.
 */
export function getPluginGeminiTools(): Array<import('@nanogemclaw/plugin-api').GeminiToolContribution> {
  return getLoadedPlugins().flatMap(p => p.plugin.geminiTools ?? []);
}

/**
 * Get all IPC handler contributions from all enabled plugins.
 */
export function getPluginIpcHandlers(): Array<import('@nanogemclaw/plugin-api').IpcHandlerContribution> {
  return getLoadedPlugins().flatMap(p => p.plugin.ipcHandlers ?? []);
}

/**
 * Get all route contributions from all enabled plugins.
 */
export function getPluginRoutes(): Array<{ pluginId: string; contribution: import('@nanogemclaw/plugin-api').RouteContribution }> {
  return getLoadedPlugins().flatMap(p =>
    (p.plugin.routes ?? []).map(r => ({ pluginId: p.plugin.id, contribution: r }))
  );
}

/**
 * Get all before-message hooks from enabled plugins.
 */
export function getBeforeMessageHooks(): Array<import('@nanogemclaw/plugin-api').BeforeMessageHook> {
  return getLoadedPlugins()
    .map(p => p.plugin.hooks?.beforeMessage)
    .filter((h): h is import('@nanogemclaw/plugin-api').BeforeMessageHook => !!h);
}

/**
 * Get all after-message hooks from enabled plugins.
 */
export function getAfterMessageHooks(): Array<import('@nanogemclaw/plugin-api').AfterMessageHook> {
  return getLoadedPlugins()
    .map(p => p.plugin.hooks?.afterMessage)
    .filter((h): h is import('@nanogemclaw/plugin-api').AfterMessageHook => !!h);
}

/**
 * Get all on-error hooks from enabled plugins.
 */
export function getOnMessageErrorHooks(): Array<import('@nanogemclaw/plugin-api').OnMessageErrorHook> {
  return getLoadedPlugins()
    .map(p => p.plugin.hooks?.onMessageError)
    .filter((h): h is import('@nanogemclaw/plugin-api').OnMessageErrorHook => !!h);
}

/**
 * Execute beforeMessage hooks in order.
 * Returns a skip signal or modified content if any hook short-circuits.
 */
export async function runBeforeMessageHooks(
  context: import('@nanogemclaw/plugin-api').MessageHookContext,
): Promise<void | string | { skip: true }> {
  for (const hook of getBeforeMessageHooks()) {
    const result = await hook(context);
    if (result !== undefined && result !== null) {
      return result;
    }
  }
}

/**
 * Execute afterMessage hooks (fire-and-forget, errors logged).
 */
export async function runAfterMessageHooks(
  context: import('@nanogemclaw/plugin-api').MessageHookContext & { reply: string },
): Promise<void> {
  for (const hook of getAfterMessageHooks()) {
    try {
      await hook(context);
    } catch (err) {
      logger.error({ err }, 'afterMessage hook error');
    }
  }
}

/**
 * Execute onMessageError hooks, returning first non-null fallback reply.
 */
export async function runOnMessageErrorHooks(
  context: import('@nanogemclaw/plugin-api').MessageHookContext & { error: Error },
): Promise<string | void> {
  for (const hook of getOnMessageErrorHooks()) {
    try {
      const result = await hook(context);
      if (result) return result;
    } catch (err) {
      logger.error({ err }, 'onMessageError hook error');
    }
  }
}

/**
 * Dispatch a plugin Gemini tool call by name.
 * Returns null if no plugin handles the tool.
 */
export async function dispatchPluginToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: import('@nanogemclaw/plugin-api').ToolExecutionContext,
): Promise<string | null> {
  for (const loaded of getLoadedPlugins()) {
    const tool = (loaded.plugin.geminiTools ?? []).find(t => t.name === toolName);
    if (!tool) continue;

    // Check permission
    if (tool.permission === 'main' && !context.isMain) {
      return JSON.stringify({ success: false, error: 'Permission denied' });
    }

    try {
      return await tool.execute(args, context);
    } catch (err) {
      logger.error({ err, toolName, pluginId: loaded.plugin.id }, 'Plugin tool execution failed');
      return JSON.stringify({ success: false, error: 'Tool execution failed' });
    }
  }
  return null;
}
