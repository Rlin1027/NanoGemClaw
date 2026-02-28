import type { RegisteredGroup, IpcContext, IpcHandler } from '@nanogemclaw/core';
import type { Router } from 'express';

// ============================================================================
// Plugin Lifecycle
// ============================================================================

export interface NanoPlugin {
  /** Unique identifier, e.g. 'weather-tool' */
  id: string;
  /** Human-readable name */
  name: string;
  /** SemVer version string */
  version: string;
  /** Optional description */
  description?: string;

  /** Called during plugin initialization (DB migrations, config loading) */
  init?(api: PluginApi): Promise<void | false>;
  /** Called after bot is connected and ready */
  start?(api: PluginApi): Promise<void>;
  /** Called during graceful shutdown */
  stop?(api: PluginApi): Promise<void>;

  /** Gemini function-calling tools this plugin provides */
  geminiTools?: GeminiToolContribution[];
  /** IPC message handlers */
  ipcHandlers?: IpcHandlerContribution[];
  /** Express routes for dashboard API */
  routes?: RouteContribution[];
  /** Background services to start */
  services?: ServiceContribution[];
  /** Message lifecycle hooks */
  hooks?: HookContributions;
}

// ============================================================================
// Plugin API (passed to plugin lifecycle methods)
// ============================================================================

export interface PluginApi {
  /** Access the SQLite database */
  getDatabase(): unknown;
  /** Send a message to a chat */
  sendMessage(chatJid: string, text: string): Promise<void>;
  /** Get registered groups */
  getGroups(): Record<string, RegisteredGroup>;
  /** Logger namespaced to this plugin */
  logger: PluginLogger;
  /** Plugin-scoped config */
  config: Record<string, unknown>;
  /** Data directory for this plugin */
  dataDir: string;
}

export interface PluginLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

// ============================================================================
// Gemini Tool Contribution
// ============================================================================

export interface GeminiToolContribution {
  /** Tool name (used in function calling) */
  name: string;
  /** Tool description for the model */
  description: string;
  /** JSON Schema for parameters */
  parameters: Record<string, unknown>;
  /** Permission: who can trigger this tool */
  permission: 'main' | 'any';
  /** Execute the tool */
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<string>;
  /** Optional safety metadata for fast-path filtering */
  metadata?: {
    /** true = safe to call on any query (default: false) */
    readOnly?: boolean;
    /** true = only call when user explicitly asks (default: false) */
    requiresExplicitIntent?: boolean;
    /** Safety classification (default: 'moderate') */
    dangerLevel?: 'safe' | 'moderate' | 'destructive';
  };
}

export interface ToolExecutionContext {
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  sendMessage: (chatJid: string, text: string) => Promise<void>;
}

// ============================================================================
// IPC Handler Contribution
// ============================================================================

export interface IpcHandlerContribution {
  /** IPC message type this handler processes */
  type: string;
  /** Permission level required */
  requiredPermission: 'main' | 'own_group' | 'any';
  /** Process the IPC message */
  handle(data: Record<string, unknown>, context: IpcContext): Promise<void>;
}

// ============================================================================
// Route Contribution
// ============================================================================

export interface RouteContribution {
  /** Route prefix (mounted at /api/plugins/{pluginId}/{prefix}) */
  prefix: string;
  /** Express router factory */
  createRouter(): Router;
}

// ============================================================================
// Service Contribution
// ============================================================================

export interface ServiceContribution {
  /** Unique service name */
  name: string;
  /** Start the background service */
  start(api: PluginApi): Promise<void>;
  /** Stop the background service */
  stop?(): Promise<void>;
}

// ============================================================================
// Hook Contributions
// ============================================================================

export interface HookContributions {
  /** Before message processing — can short-circuit or skip */
  beforeMessage?: BeforeMessageHook;
  /** After successful reply — fire-and-forget (logging, analytics) */
  afterMessage?: AfterMessageHook;
  /** On error — can provide fallback reply */
  onMessageError?: OnMessageErrorHook;
}

export type BeforeMessageHook = (
  context: MessageHookContext,
) => Promise<void | string | { skip: true }>;

export type AfterMessageHook = (
  context: MessageHookContext & { reply: string },
) => Promise<void>;

export type OnMessageErrorHook = (
  context: MessageHookContext & { error: Error },
) => Promise<void | string>;

export interface MessageHookContext {
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  groupFolder: string;
  isMain: boolean;
  timestamp: string;
}

// ============================================================================
// Plugin Registry (used by the app to manage plugins)
// ============================================================================

export interface PluginRegistryEntry {
  /** npm package name or local path */
  source: string;
  /** Plugin-specific configuration */
  config: Record<string, unknown>;
  /** Whether this plugin is enabled */
  enabled: boolean;
}

export interface PluginManifest {
  plugins: PluginRegistryEntry[];
  /** Set to true to disable auto-discovery (default: false) */
  disableDiscovery?: boolean;
}

// ============================================================================
// Plugin Discovery
// ============================================================================

export type PluginOrigin = 'directory' | 'npm-scope' | 'manifest';

export interface DiscoveredPlugin extends PluginRegistryEntry {
  /** How this plugin was found */
  origin: PluginOrigin;
}

// Re-export IpcHandler from core for convenience (plugins implementing IPC handlers may need it)
export type { IpcContext, IpcHandler } from '@nanogemclaw/core';
