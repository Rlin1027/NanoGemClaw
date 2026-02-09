export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath: string; // Path inside container (under /workspace/extra/)
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
  env?: Record<string, string>;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  /** Custom system prompt for this group's persona */
  systemPrompt?: string;
  /** Pre-defined persona key (e.g. 'coder', 'assistant', 'translator') */
  persona?: string;
  /** Enable Google Search grounding for up-to-date information (default: true) */
  enableWebSearch?: boolean;
  /** Require @trigger prefix to respond (default: true for non-main groups) */
  requireTrigger?: boolean;
  /** Gemini model to use for this group (e.g. 'gemini-3-flash-preview', 'gemini-3-pro-preview') */
  geminiModel?: string;
}

export interface Session {
  [folder: string]: string;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

// ============================================================================
// IPC Handler Plugin Interface
// ============================================================================

export interface IpcContext {
  sourceGroup: string;
  isMain: boolean;
  registeredGroups: Record<string, RegisteredGroup>;
  sendMessage: (chatJid: string, text: string) => Promise<void>;
  registerGroup?: (chatId: string, group: RegisteredGroup) => void;
  bot?: any; // TelegramBot instance for media sending
}

export interface IpcHandler {
  /** IPC message type this handler processes (e.g. 'schedule_task') */
  type: string;
  /** Permission level required */
  requiredPermission: 'main' | 'own_group' | 'any';
  /** Process the IPC message */
  handle(data: Record<string, any>, context: IpcContext): Promise<void>;
}
