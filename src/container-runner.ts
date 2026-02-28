/**
 * Container Runner for NanoGemClaw
 * Spawns agent execution in Apple Container and handles IPC
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
} from './config.js';
import { buildContainerArgs, buildVolumeMounts } from './container-mounts.js';
import { groupLockManager } from './group-lock-manager.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

// Dashboard event callback - injected by index.ts to avoid circular dependency
let dashboardEventEmitter: ((event: string, data: unknown) => void) | null =
  null;

/**
 * Set the dashboard event emitter callback.
 * Called from index.ts after server initialization.
 */
export function setDashboardEventEmitter(
  fn: (event: string, data: unknown) => void,
): void {
  dashboardEventEmitter = fn;
}

function emitDashboardEvent(event: string, data: unknown): void {
  if (dashboardEventEmitter) {
    dashboardEventEmitter(event, data);
  }
}

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  /** Custom system prompt for group persona */
  systemPrompt?: string;
  /** Pre-defined persona key */
  persona?: string;
  /** Enable Google Search grounding (default: true) */
  enableWebSearch?: boolean;
  /** Path to media file (image/voice/document) for multi-modal input */
  mediaPath?: string;
  /** Memory context from conversation summaries */
  memoryContext?: string;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
  promptTokens?: number;
  responseTokens?: number;
}

export interface ProgressInfo {
  type: 'tool_use' | 'thinking' | 'message';
  toolName?: string;
  content?: string;
  contentDelta?: string; // 增量文字內容
  contentSnapshot?: string; // 當前完整累積文字（供 editMessage 使用）
  isComplete?: boolean; // 回覆是否完成
}

/**
 * Run a container agent for a group with per-group concurrency control.
 * Only one container can run per group at a time (messages, tasks, IPC all queue).
 */
export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProgress?: (info: ProgressInfo) => void,
): Promise<ContainerOutput> {
  logger.debug(
    {
      group: group.name,
      hasPending: groupLockManager.hasPending(group.folder),
    },
    'Acquiring group lock for container execution',
  );

  return groupLockManager.withLock(group.folder, async () => {
    // Notify dashboard: agent is thinking
    emitDashboardEvent('agent:status', {
      groupFolder: group.folder,
      status: 'thinking',
    });

    const startTime = Date.now();
    const result = await runContainerAgentInternal(group, input, onProgress);
    const durationMs = Date.now() - startTime;

    // Log usage statistics and track errors
    try {
      const { logUsage, resetErrors, recordError } = await import('./db.js');
      logUsage({
        group_folder: input.groupFolder,
        timestamp: new Date().toISOString(),
        duration_ms: durationMs,
        is_scheduled_task: input.isScheduledTask,
        prompt_tokens: result.promptTokens,
        response_tokens: result.responseTokens,
      });

      // Track errors/success
      if (result.status === 'error') {
        const errorState = recordError(
          input.groupFolder,
          result.error || 'Unknown error',
        );

        // Send webhook if new error or threshold reached
        if (
          errorState.consecutiveFailures === 1 ||
          errorState.consecutiveFailures % 3 === 0
        ) {
          const { sendWebhookNotification } = await import('./webhook.js');
          await sendWebhookNotification(
            'error',
            `Container error in group ${group.name}`,
            {
              group: input.groupFolder,
              error: result.error,
              failures: errorState.consecutiveFailures,
            },
          );
        }
      } else {
        resetErrors(input.groupFolder);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to log usage stats');
    }

    // Notify dashboard: agent finished
    emitDashboardEvent('agent:status', {
      groupFolder: group.folder,
      status: result.status === 'error' ? 'error' : 'idle',
      error: result.status === 'error' ? result.error : undefined,
    });

    return result;
  });
}

/**
 * Internal implementation of container agent execution.
 * Should only be called through runContainerAgent which handles locking.
 */
async function runContainerAgentInternal(
  group: RegisteredGroup,
  input: ContainerInput,
  onProgress?: (info: ProgressInfo) => void,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);

  // Resolve system prompt with persona
  const { getEffectiveSystemPrompt } = await import('./personas.js');
  let systemPrompt = getEffectiveSystemPrompt(
    input.systemPrompt,
    input.persona,
  );

  // Add follow-up suggestions instruction if enabled (default: on)
  if ((group as any).enableFollowUp !== false) {
    const followUpInstruction = `

After your response, if there are natural follow-up questions the user might ask, suggest 2-3 of them on separate lines at the very end of your response, each prefixed with ">>>" (three greater-than signs). For example:
>>> What are the other options?
>>> Can you explain in more detail?
>>> Show me an example
Only suggest follow-ups when they genuinely add value. Do not suggest them for simple greetings or short answers.`;
    systemPrompt = (systemPrompt || '') + followUpInstruction;
  }

  // Sanitize system prompt - remove newlines and control characters that could affect env var parsing
  const sanitizedPrompt = (systemPrompt || '').replace(/[\n\r\0]/g, ' ').trim();

  // Write GEMINI_SYSTEM_PROMPT to the per-group env file instead of passing via -e CLI arg.
  // This avoids exposing potentially large/sensitive prompt content in the process argument list
  // and keeps all runtime env vars in the already-mounted /workspace/env-dir.
  const envDir = path.join(DATA_DIR, 'env', group.folder);
  fs.mkdirSync(envDir, { recursive: true });
  const envFilePath = path.join(envDir, 'env');
  const existingEnvContent = fs.existsSync(envFilePath)
    ? fs.readFileSync(envFilePath, 'utf-8')
    : '';
  // Remove any existing GEMINI_SYSTEM_PROMPT line, then append the current value
  const envLines = existingEnvContent
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('GEMINI_SYSTEM_PROMPT='));
  const shellQuoted = sanitizedPrompt.replace(/'/g, "'\\''");
  envLines.push(`GEMINI_SYSTEM_PROMPT='${shellQuoted}'`);
  fs.writeFileSync(envFilePath, envLines.join('\n') + '\n');

  // Ensure the env-dir mount is present (buildVolumeMounts adds it only when .env exists with API keys)
  const envDirMountExists = mounts.some(
    (m) => m.containerPath === '/workspace/env-dir',
  );
  if (!envDirMountExists) {
    mounts.push({
      hostPath: envDir,
      containerPath: '/workspace/env-dir',
      readonly: true,
    });
  }

  // Build base args including mounts
  const baseArgs = buildContainerArgs(mounts);

  // Extract image (last argument)
  const image = baseArgs.pop();

  // Inject environment variables before the image argument (GEMINI_SYSTEM_PROMPT is now in env file)
  baseArgs.push(
    '-e',
    `GEMINI_ENABLE_SEARCH=${input.enableWebSearch !== false ? 'true' : 'false'}`,
    '-e',
    `GEMINI_MODEL=${(!group.geminiModel || group.geminiModel === 'auto') ? (await import('./config.js')).getDefaultModel() : group.geminiModel}`,
    '-e',
    `CONTAINER_TIMEOUT=${CONTAINER_TIMEOUT}`,
  );

  // Re-append image
  if (image) baseArgs.push(image);

  const containerArgs = baseArgs;

  logger.debug(
    {
      group: group.name,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs
        .map((a) =>
          a.startsWith('GEMINI_API_KEY=') ? 'GEMINI_API_KEY=[REDACTED]' : a,
        )
        .join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      mountCount: mounts.length,
      isMain: input.isMain,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn('container', containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    container.stdin.write(JSON.stringify(input));
    container.stdin.end();

    let lastProgressTime = 0;
    const PROGRESS_THROTTLE_MS = 2000;
    let contentBuffer = ''; // Accumulate message content for streaming

    container.stdout.on('data', (data) => {
      if (stdoutTruncated) return;
      const chunk = data.toString();
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
        logger.warn(
          { group: group.name, size: stdout.length },
          'Container stdout truncated due to size limit',
        );
      } else {
        stdout += chunk;
      }

      // Try to parse stream-json events for progress
      if (onProgress) {
        const lines = chunk.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('{')) continue;
          try {
            const event = JSON.parse(trimmed);
            const now = Date.now();

            if (event.type === 'tool_use' && event.tool_name) {
              if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
                lastProgressTime = now;
                onProgress({
                  type: 'tool_use',
                  toolName: event.tool_name,
                });
              }
            } else if (event.type === 'message' && event.content) {
              // Accumulate content for streaming
              const delta = event.content.substring(contentBuffer.length);
              contentBuffer = event.content;

              // Only send progress updates respecting throttle
              if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
                lastProgressTime = now;
                onProgress({
                  type: 'message',
                  content: event.content.substring(0, 100), // Backward compat
                  contentDelta: delta,
                  contentSnapshot: contentBuffer,
                  isComplete: false,
                });
              }
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    // Timeout handling with graceful shutdown
    // First send SIGTERM for graceful exit, then SIGKILL if still running
    let timeoutResolved = false;

    const timeout = setTimeout(() => {
      logger.warn(
        { group: group.name },
        'Container timeout, attempting graceful shutdown',
      );
      container.kill('SIGTERM');

      // If still running after grace period, force kill
      setTimeout(() => {
        if (!container.killed && !timeoutResolved) {
          logger.error(
            { group: group.name },
            'Container did not exit gracefully, forcing SIGKILL',
          );
          container.kill('SIGKILL');
        }
      }, CONTAINER.GRACEFUL_SHUTDOWN_DELAY_MS);

      // Resolve immediately to unblock caller
      timeoutResolved = true;
      resolve({
        status: 'error',
        result: null,
        error: `Container timed out after ${CONTAINER_TIMEOUT}ms`,
      });
    }, group.containerConfig?.timeout || CONTAINER_TIMEOUT);

    container.on('close', (code) => {
      clearTimeout(timeout);

      // Skip if timeout already resolved this promise
      if (timeoutResolved) {
        logger.debug(
          { group: group.name, code },
          'Container closed after timeout (ignored)',
        );
        return;
      }

      const duration = Date.now() - startTime;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      if (isVerbose) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Container Args ===`,
          containerArgs.join(' '),
          ``,
          `=== Mounts ===`,
          mounts
            .map(
              (m) =>
                `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
            )
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
          `=== Mounts ===`,
          mounts
            .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
            .join('\n'),
          ``,
        );

        if (code !== 0) {
          logLines.push(
            `=== Stderr (last 500 chars) ===`,
            stderr.slice(-500),
            ``,
          );
        }
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr: stderr.slice(-500),
            logFile,
          },
          'Container exited with error',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        // Send final completion event with full content
        if (onProgress && contentBuffer) {
          onProgress({
            type: 'message',
            content: contentBuffer.substring(0, 100), // Backward compat
            contentSnapshot: contentBuffer,
            isComplete: true,
          });
        }

        resolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout: stdout.slice(-500),
            error: err,
          },
          'Failed to parse container output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      if (timeoutResolved) return; // Already handled by timeout
      clearTimeout(timeout);
      logger.error({ group: group.name, error: err }, 'Container spawn error');
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

// Backward compatibility re-exports
export { GroupLockManager, groupLockManager } from './group-lock-manager.js';
export {
  type AvailableGroup,
  writeTasksSnapshot,
  writeGroupsSnapshot,
} from './container-ipc.js';
export type { VolumeMount } from './container-mounts.js';
