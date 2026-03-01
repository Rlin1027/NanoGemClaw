/**
 * Event type map for NanoGemClaw.
 * All payloads are plain data (no class instances, no functions).
 */
export interface NanoEventMap {
  'message:received': {
    chatId: string;
    sender: string;
    senderName: string;
    content: string;
    timestamp: string;
    groupFolder: string;
    messageThreadId?: string | null;
  };
  'message:sent': {
    chatId: string;
    content: string;
    timestamp: string;
    groupFolder: string;
    messageThreadId?: number | null;
  };
  'group:registered': {
    chatId: string;
    groupFolder: string;
    name: string;
  };
  'group:unregistered': {
    chatId: string;
    groupFolder: string;
  };
  'group:updated': {
    groupFolder: string;
    changes: Record<string, unknown>;
  };
  'task:created': {
    taskId: string;
    groupFolder: string;
  };
  'task:completed': {
    taskId: string;
    groupFolder: string;
    result: string;
  };
  'task:failed': {
    taskId: string;
    groupFolder: string;
    error: string;
  };
  'memory:fact-stored': {
    groupFolder: string;
    key: string;
    value: string;
  };
  'memory:summarized': {
    groupFolder: string;
    chunkIndex: number;
  };
  'system:ready': Record<string, never>;
  'system:shutdown': Record<string, never>;
}
