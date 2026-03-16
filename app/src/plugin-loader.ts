/**
 * Plugin Loader
 *
 * Loads, initializes, starts, and stops NanoPlugin instances.
 * Plugins are loaded from the plugin manifest at startup.
 */

import path from 'path';
import fs from 'fs';
import { logger, scanForInjection } from '@nanogemclaw/core';
import type {
  NanoPlugin,
  PluginApi,
  PluginManifest,
  PluginRegistryEntry,
} from '@nanogemclaw/plugin-api';
import type { LoadedPlugin, DiscoveredPlugin } from './plugin-types.js';
import {
  discoverDirectoryPlugins,
  discoverNpmScopePlugins,
  mergePluginSources,
} from './plugin-discovery.js';

// ============================================================================
// Registry
// ============================================================================

const loadedPlugins: LoadedPlugin[] = [];

// Internal (builtin) plugins — prepended to getLoadedPlugins() so they run first
const internalPlugins: (import('@nanogemclaw/plugin-api').NanoPlugin & { builtin: true })[] = [];

// Module-level eventBus reference, set when plugins are loaded
let moduleEventBus: import('@nanogemclaw/event-bus').EventBus | undefined;

// Module-level references for persist operations
let moduleManifestPath: string | undefined;
let moduleDeps:
  | {
      getDatabase(): unknown;
      sendMessage(chatJid: string, text: string): Promise<void>;
      getGroups(): Record<string, import('@nanogemclaw/core').RegisteredGroup>;
      eventBus?: import('@nanogemclaw/event-bus').EventBus;
      dataDir: string;
    }
  | undefined;

export function registerInternalPlugin(
  plugin: import('@nanogemclaw/plugin-api').NanoPlugin & { builtin: true },
): void {
  internalPlugins.push(plugin);
}

// Register the built-in injection scanner plugin
registerInternalPlugin({
  id: 'builtin-injection-scanner',
  name: 'Built-in Injection Scanner',
  version: '1.0.0',
  builtin: true,
  hooks: {
    afterToolCall: async (ctx) => {
      const text =
        typeof ctx.result === 'string' ? ctx.result : JSON.stringify(ctx.result);
      const scan = scanForInjection(text);
      if (scan.status === 'suspicious') {
        logger.warn('Potential prompt injection detected in tool result', {
          toolName: ctx.toolName,
          patterns: scan.patterns,
          groupFolder: ctx.groupFolder,
        });
        if (moduleEventBus) {
          moduleEventBus.emit('security:injection-detected', {
            toolName: ctx.toolName,
            patterns: scan.patterns ?? [],
            groupFolder: ctx.groupFolder,
            chatJid: ctx.chatJid,
          });
        }
      }
      // Log-only: never modify the result
      return undefined;
    },
  },
});

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
    eventBus?: import('@nanogemclaw/event-bus').EventBus;
  },
): PluginApi {
  const pluginLogger = {
    info: (msg: string, ...args: unknown[]) =>
      logger.info({ plugin: pluginId }, msg, ...args),
    warn: (msg: string, ...args: unknown[]) =>
      logger.warn({ plugin: pluginId }, msg, ...args),
    error: (msg: string, ...args: unknown[]) =>
      logger.error({ plugin: pluginId }, msg, ...args),
    debug: (msg: string, ...args: unknown[]) =>
      logger.debug({ plugin: pluginId }, msg, ...args),
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
    eventBus: deps.eventBus,
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
    eventBus?: import('@nanogemclaw/event-bus').EventBus;
    dataDir: string;
  },
): Promise<void> {
  moduleEventBus = deps.eventBus;
  if (!fs.existsSync(manifestPath)) {
    logger.debug(
      { manifestPath },
      'No plugin manifest found, skipping plugin load',
    );
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

// ============================================================================
// Dependency-aware plugin ordering (best-effort topological sort)
// ============================================================================

/**
 * Sort plugins so that dependencies load before dependents.
 * Falls back to original order for plugins without dependsOn or on cycles.
 */
function topoSortPlugins<T extends { source: string; dependsOn?: string[] }>(
  plugins: T[],
): T[] {
  // Build a map from plugin source basename (assumed to be the plugin ID) to entry
  const byId = new Map<string, T>();
  for (const p of plugins) {
    // Use last path segment or full source as ID
    const id = p.source.split('/').pop()?.replace(/^@nanogemclaw-plugin\//, '') ?? p.source;
    byId.set(id, p);
  }

  const sorted: T[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>(); // cycle detection

  function visit(plugin: T): void {
    const id = plugin.source.split('/').pop()?.replace(/^@nanogemclaw-plugin\//, '') ?? plugin.source;
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      // Cycle detected — skip to break the cycle
      logger.warn({ plugin: id }, 'Plugin dependency cycle detected, loading in original order');
      return;
    }
    visiting.add(id);

    for (const depId of plugin.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }

    visiting.delete(id);
    visited.add(id);
    sorted.push(plugin);
  }

  for (const p of plugins) visit(p);
  return sorted;
}

// ============================================================================
// Discover and load plugins (manifest + auto-discovery)
// ============================================================================

export interface DiscoverAndLoadOptions {
  /** Directory to scan for local plugins. Default: undefined (skip) */
  pluginsDir?: string;
  /** node_modules directory for scope scanning. Default: undefined (skip) */
  nodeModulesDir?: string;
}

export async function discoverAndLoadPlugins(
  manifestPath: string,
  deps: {
    getDatabase(): unknown;
    sendMessage(chatJid: string, text: string): Promise<void>;
    getGroups(): Record<string, import('@nanogemclaw/core').RegisteredGroup>;
    eventBus?: import('@nanogemclaw/event-bus').EventBus;
    dataDir: string;
  },
  options?: DiscoverAndLoadOptions,
): Promise<void> {
  moduleEventBus = deps.eventBus;
  moduleManifestPath = manifestPath;
  moduleDeps = deps;

  // Register MCP bridge plugin (only when plugins are actually being loaded)
  try {
    const { createMcpPlugin } = await import('./mcp/index.js');
    registerInternalPlugin(createMcpPlugin(deps.dataDir));
  } catch (err) {
    logger.warn({ err }, 'Failed to register MCP bridge plugin');
  }

  // 1. Read manifest (tolerant of missing file)
  let manifest: PluginManifest = { plugins: [] };
  if (fs.existsSync(manifestPath)) {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(raw) as PluginManifest;
    } catch (err) {
      logger.error({ err, manifestPath }, 'Failed to parse plugin manifest');
      return;
    }
  }

  // 2. Auto-discover (unless disabled by manifest or no dirs provided)
  let directoryPlugins: DiscoveredPlugin[] = [];
  let npmScopePlugins: DiscoveredPlugin[] = [];

  if (!manifest.disableDiscovery) {
    if (options?.pluginsDir) {
      directoryPlugins = discoverDirectoryPlugins(options.pluginsDir);
    }
    if (options?.nodeModulesDir) {
      npmScopePlugins = discoverNpmScopePlugins(options.nodeModulesDir);
    }
  }

  // 3. Merge: manifest wins on collision
  const merged = mergePluginSources(
    manifest.plugins,
    directoryPlugins,
    npmScopePlugins,
  );

  // 4. Log discovery summary
  const counts: Record<string, number> = {
    manifest: 0,
    directory: 0,
    'npm-scope': 0,
  };
  for (const p of merged) counts[p.origin]++;
  logger.info(counts, 'Plugin discovery complete');

  // 5. Sort plugins by dependsOn (simple topological sort, best-effort)
  const sorted = topoSortPlugins(merged);

  // 6. Load each plugin
  for (const entry of sorted) {
    if (!entry.enabled) {
      logger.debug(
        { source: entry.source, origin: entry.origin },
        'Plugin disabled, skipping',
      );
      continue;
    }
    await loadPlugin(entry, deps);
  }

  logger.info({ count: loadedPlugins.length }, 'Plugins loaded');
}

function persistPluginState(pluginId: string, enabled: boolean): void {
  if (!moduleManifestPath) return;

  let manifest: PluginManifest = { plugins: [] };
  try {
    if (fs.existsSync(moduleManifestPath)) {
      manifest = JSON.parse(fs.readFileSync(moduleManifestPath, 'utf-8')) as PluginManifest;
    }
  } catch {
    // If manifest is unreadable, start fresh
  }

  const idx = manifest.plugins.findIndex(p => {
    const id = p.source.split('/').pop()?.replace(/^@nanogemclaw-plugin\//, '') ?? p.source;
    return id === pluginId || p.source.includes(pluginId);
  });

  if (idx >= 0) {
    manifest.plugins[idx].enabled = enabled;
  } else {
    // Auto-discovered plugin, add override entry
    manifest.plugins.push({
      source: pluginId,
      enabled,
      config: {},
    });
  }

  // Atomic write: write to tmp, then rename
  const tmpPath = moduleManifestPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmpPath, moduleManifestPath);
}

async function loadPlugin(
  entry: PluginRegistryEntry,
  deps: {
    getDatabase(): unknown;
    sendMessage(chatJid: string, text: string): Promise<void>;
    getGroups(): Record<string, import('@nanogemclaw/core').RegisteredGroup>;
    eventBus?: import('@nanogemclaw/event-bus').EventBus;
    dataDir: string;
  },
): Promise<void> {
  try {
    const mod = await import(entry.source);
    const plugin: NanoPlugin = mod.default ?? mod.plugin;

    if (!plugin || !plugin.id) {
      logger.warn(
        { source: entry.source },
        'Invalid plugin: missing id or default export',
      );
      return;
    }

    // Guard: duplicate plugin ID
    const existing = loadedPlugins.find((p) => p.plugin.id === plugin.id);
    if (existing) {
      logger.info(
        {
          pluginId: plugin.id,
          skippedSource: entry.source,
          skippedOrigin: (entry as DiscoveredPlugin).origin ?? 'manifest',
        },
        'Duplicate plugin ID, keeping first loaded instance',
      );
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
        logger.warn(
          { pluginId: loaded.plugin.id },
          'Plugin init returned false, disabling',
        );
      }
    } catch (err) {
      loaded.enabled = false;
      logger.error(
        { err, pluginId: loaded.plugin.id },
        'Plugin init failed, disabling',
      );
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

export async function disablePlugin(pluginId: string): Promise<boolean> {
  const loaded = loadedPlugins.find(p => p.plugin.id === pluginId);
  if (!loaded || !loaded.enabled) return false;

  loaded.enabled = false;

  // Stop the plugin gracefully
  if (loaded.plugin.stop) {
    try {
      await loaded.plugin.stop(loaded.api);
    } catch (err) {
      logger.error({ err, pluginId }, 'Error stopping disabled plugin');
    }
  }

  persistPluginState(pluginId, false);
  logger.info({ pluginId }, 'Plugin disabled and persisted');
  return true;
}

export async function enablePlugin(pluginId: string): Promise<boolean> {
  const loaded = loadedPlugins.find(p => p.plugin.id === pluginId);
  if (!loaded) return false;
  if (loaded.enabled) return true; // Already enabled

  loaded.enabled = true;

  // Re-init and start the plugin
  if (loaded.plugin.init) {
    try {
      const result = await loaded.plugin.init(loaded.api);
      if (result === false) {
        loaded.enabled = false;
        logger.warn({ pluginId }, 'Plugin init returned false during enable');
        return false;
      }
    } catch (err) {
      loaded.enabled = false;
      logger.error({ err, pluginId }, 'Plugin init failed during enable');
      return false;
    }
  }

  if (loaded.plugin.start) {
    try {
      await loaded.plugin.start(loaded.api);
    } catch (err) {
      logger.error({ err, pluginId }, 'Plugin start failed during enable');
    }
  }

  persistPluginState(pluginId, true);
  logger.info({ pluginId }, 'Plugin enabled and persisted');
  return true;
}

// ============================================================================
// Accessors for other modules
// ============================================================================

export function getLoadedPlugins(): LoadedPlugin[] {
  // Builtin internal plugins always run first and cannot be disabled
  const builtinEntries: LoadedPlugin[] = internalPlugins.map((p) => ({
    plugin: p,
    api: undefined as unknown as import('@nanogemclaw/plugin-api').PluginApi,
    config: {},
    enabled: true,
  }));
  return [...builtinEntries, ...loadedPlugins.filter((p) => p.enabled)];
}

/**
 * Get all Gemini tool contributions from all enabled plugins.
 * Also populates the inputSchemaRegistry for tools that declare inputSchema.
 */
export function getPluginGeminiTools(): Array<
  import('@nanogemclaw/plugin-api').GeminiToolContribution
> {
  const tools = getLoadedPlugins().flatMap((p) => p.plugin.geminiTools ?? []);

  // Populate inputSchemaRegistry for tools that declare inputSchema.
  // Dynamic import avoids pulling config.ts into test environments at module-load time.
  void import('../../src/gemini-tools.js')
    .then(({ registerInputSchema, clearInputSchemaRegistry }) => {
      clearInputSchemaRegistry();
      for (const tool of tools) {
        if (tool.inputSchema && typeof tool.inputSchema.parse === 'function') {
          registerInputSchema(tool.name, tool.inputSchema as { parse(data: unknown): unknown });
        }
      }
    })
    .catch((err: unknown) => {
      logger.warn({ err }, 'Failed to populate inputSchemaRegistry');
    });

  return tools;
}

/**
 * Get metadata for all plugin tools that declare it.
 * Returns array of { name, metadata } for registration into the central registry.
 */
export function getPluginToolMetadataEntries(): Array<{
  name: string;
  metadata: { readOnly: boolean; requiresExplicitIntent: boolean; dangerLevel: 'safe' | 'moderate' | 'destructive' };
}> {
  const entries: Array<{
    name: string;
    metadata: { readOnly: boolean; requiresExplicitIntent: boolean; dangerLevel: 'safe' | 'moderate' | 'destructive' };
  }> = [];
  for (const tool of getPluginGeminiTools()) {
    entries.push({
      name: tool.name,
      metadata: {
        readOnly: tool.metadata?.readOnly ?? false,
        requiresExplicitIntent: tool.metadata?.requiresExplicitIntent ?? false,
        dangerLevel: tool.metadata?.dangerLevel ?? 'moderate',
      },
    });
  }
  return entries;
}

/**
 * Get all IPC handler contributions from all enabled plugins.
 */
export function getPluginIpcHandlers(): Array<
  import('@nanogemclaw/plugin-api').IpcHandlerContribution
> {
  return getLoadedPlugins().flatMap((p) => p.plugin.ipcHandlers ?? []);
}

/**
 * Get all route contributions from all enabled plugins.
 */
export function getPluginRoutes(): Array<{
  pluginId: string;
  contribution: import('@nanogemclaw/plugin-api').RouteContribution;
}> {
  return getLoadedPlugins().flatMap((p) =>
    (p.plugin.routes ?? []).map((r) => ({
      pluginId: p.plugin.id,
      contribution: r,
    })),
  );
}

/**
 * Get all before-message hooks from enabled plugins.
 */
export function getBeforeMessageHooks(): Array<
  import('@nanogemclaw/plugin-api').BeforeMessageHook
> {
  return getLoadedPlugins()
    .map((p) => p.plugin.hooks?.beforeMessage)
    .filter(
      (h): h is import('@nanogemclaw/plugin-api').BeforeMessageHook => !!h,
    );
}

/**
 * Get all after-message hooks from enabled plugins.
 */
export function getAfterMessageHooks(): Array<
  import('@nanogemclaw/plugin-api').AfterMessageHook
> {
  return getLoadedPlugins()
    .map((p) => p.plugin.hooks?.afterMessage)
    .filter(
      (h): h is import('@nanogemclaw/plugin-api').AfterMessageHook => !!h,
    );
}

/**
 * Get all on-error hooks from enabled plugins.
 */
export function getOnMessageErrorHooks(): Array<
  import('@nanogemclaw/plugin-api').OnMessageErrorHook
> {
  return getLoadedPlugins()
    .map((p) => p.plugin.hooks?.onMessageError)
    .filter(
      (h): h is import('@nanogemclaw/plugin-api').OnMessageErrorHook => !!h,
    );
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
  context: import('@nanogemclaw/plugin-api').MessageHookContext & {
    reply: string;
  },
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
  context: import('@nanogemclaw/plugin-api').MessageHookContext & {
    error: Error;
  },
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

// TODO: extract HookPipeline<T> if a third hook domain is added

// --- Tool hook collection ---

/**
 * Get all before-tool-call hooks from enabled plugins (including builtins).
 */
export function getBeforeToolCallHooks(): Array<
  import('@nanogemclaw/plugin-api').BeforeToolCallHook
> {
  return getLoadedPlugins()
    .map((p) => p.plugin.hooks?.beforeToolCall)
    .filter(
      (h): h is import('@nanogemclaw/plugin-api').BeforeToolCallHook => h != null,
    );
}

/**
 * Get all after-tool-call hooks from enabled plugins (including builtins).
 */
export function getAfterToolCallHooks(): Array<
  import('@nanogemclaw/plugin-api').AfterToolCallHook
> {
  return getLoadedPlugins()
    .map((p) => p.plugin.hooks?.afterToolCall)
    .filter(
      (h): h is import('@nanogemclaw/plugin-api').AfterToolCallHook => h != null,
    );
}

/**
 * Execute beforeToolCall hooks in order.
 * Returns block signal if any hook blocks the call.
 * If any hook throws, the error propagates (broken gate = closed).
 */
export async function runBeforeToolCallHooks(
  context: import('@nanogemclaw/plugin-api').ToolCallHookContext,
): Promise<{ block: true; reason: string } | null> {
  for (const hook of getBeforeToolCallHooks()) {
    const result = await hook(context);
    if (result && 'block' in result && result.block) {
      return result;
    }
  }
  return null;
}

/**
 * Execute afterToolCall hooks in order.
 * Errors are logged and swallowed (matching afterMessage pattern).
 * Each hook may modify the result for subsequent hooks.
 * Returns the final (possibly modified) result, or null if unchanged.
 */
export async function runAfterToolCallHooks(
  context: import('@nanogemclaw/plugin-api').ToolCallHookContext & {
    result: Record<string, unknown>;
  },
): Promise<Record<string, unknown> | null> {
  let currentResult = context.result;
  let modified = false;
  for (const hook of getAfterToolCallHooks()) {
    try {
      const hookResult = await hook({ ...context, result: currentResult });
      if (hookResult && 'modifiedResult' in hookResult) {
        currentResult = hookResult.modifiedResult;
        modified = true;
      }
    } catch (err) {
      logger.error({ err }, 'afterToolCall hook error');
    }
  }
  return modified ? currentResult : null;
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
    const tool = (loaded.plugin.geminiTools ?? []).find(
      (t) => t.name === toolName,
    );
    if (!tool) continue;

    // Check permission
    if (tool.permission === 'main' && !context.isMain) {
      return JSON.stringify({ success: false, error: 'Permission denied' });
    }

    try {
      return await tool.execute(args, context);
    } catch (err) {
      logger.error(
        { err, toolName, pluginId: loaded.plugin.id },
        'Plugin tool execution failed',
      );
      return JSON.stringify({ success: false, error: 'Tool execution failed' });
    }
  }
  return null;
}
