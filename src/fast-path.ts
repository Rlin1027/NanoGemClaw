/**
 * Fast Path - Direct Gemini API execution with streaming.
 *
 * Provides a high-performance alternative to container-based execution
 * for simple conversational queries. Features:
 *
 * 1. Context Caching: Caches system prompt + knowledge for 75-90% cost reduction
 * 2. Streaming: Real-time token streaming to Telegram
 * 3. Function Calling: Native Gemini function calling replaces file-based IPC
 *
 * The fast path is used when:
 * - The group has enableFastPath !== false (default: enabled)
 * - The message doesn't contain media that needs container processing
 * - The Gemini API client is available (API key configured)
 *
 * Falls back to container execution when:
 * - Media files are attached (images, voice, documents)
 * - Group explicitly disables fast path
 * - API key is not available
 */

import type { Content } from '@google/genai';

import { FAST_PATH, getDefaultModel } from './config.js';
import { getOrCreateCache } from './context-cache.js';
import { isGeminiClientAvailable, streamGenerate } from './gemini-client.js';
import {
  buildFunctionDeclarations,
  executeFunctionCall,
  type FunctionCallResult,
} from './gemini-tools.js';
import type { ContainerOutput, ProgressInfo } from './container-runner.js';
import { logger } from './logger.js';
import type { RegisteredGroup, IpcContext } from './types.js';

// ============================================================================
// Tool Safety Classification
// ============================================================================

/** Read-only tools safe to call on any query */
const READ_ONLY_TOOLS = new Set(['list_tasks']);

/** Mutating tools that require explicit user intent */
const MUTATING_TOOLS = new Set([
  'cancel_task',
  'pause_task',
  'resume_task',
  'schedule_task',
  'set_preference',
  'generate_image',
  'register_group',
]);

/**
 * Filter a mixed batch of function calls: if both read-only and mutating tools
 * are present, drop the mutating ones (their args are hallucinated because the
 * model hasn't seen list results yet).
 *
 * Mutates arrays in-place. Returns true if any mutating calls were dropped.
 */
function filterMixedBatch(
  pendingFunctionCalls: Array<{ name: string; args: Record<string, any> }>,
  rawFunctionCallParts: any[],
  groupName: string,
): boolean {
  const hasReadOnly = pendingFunctionCalls.some((fc) => READ_ONLY_TOOLS.has(fc.name));
  const hasMutating = pendingFunctionCalls.some((fc) => MUTATING_TOOLS.has(fc.name));

  if (!hasReadOnly || !hasMutating) return false;

  const dropped = pendingFunctionCalls.filter((fc) => MUTATING_TOOLS.has(fc.name));
  logger.warn(
    { group: groupName, dropped: dropped.map((fc) => fc.name) },
    'Fast path: dropping mutating tools from mixed batch (hallucinated args)',
  );

  // Keep only non-mutating calls
  const readOnly = pendingFunctionCalls.filter((fc) => !MUTATING_TOOLS.has(fc.name));
  pendingFunctionCalls.length = 0;
  pendingFunctionCalls.push(...readOnly);

  // Sync rawFunctionCallParts
  const readOnlyNames = new Set(readOnly.map((fc) => fc.name));
  const filteredRaw = rawFunctionCallParts.filter(
    (p: any) => p.functionCall && readOnlyNames.has(p.functionCall.name),
  );
  rawFunctionCallParts.length = 0;
  rawFunctionCallParts.push(...filteredRaw);

  return true;
}

/**
 * Sort function calls so read-only tools come first, then truncate to limit.
 * This ensures read-only tools survive the MAX_CALLS_PER_TURN cut.
 *
 * Mutates arrays in-place.
 */
function prioritizedTruncate(
  pendingFunctionCalls: Array<{ name: string; args: Record<string, any> }>,
  rawFunctionCallParts: any[],
  limit: number,
  groupName: string,
  round?: number,
): void {
  // Sort: read-only first, then mutating
  pendingFunctionCalls.sort((a, b) => {
    const aPriority = READ_ONLY_TOOLS.has(a.name) ? 0 : 1;
    const bPriority = READ_ONLY_TOOLS.has(b.name) ? 0 : 1;
    return aPriority - bPriority;
  });

  const dropped = pendingFunctionCalls.slice(limit).map((fc) => fc.name);
  logger.warn(
    {
      group: groupName,
      ...(round != null && { round }),
      total: pendingFunctionCalls.length,
      kept: limit,
      dropped,
    },
    round != null
      ? 'Fast path: dropping excess function calls in round'
      : 'Fast path: dropping excess function calls',
  );

  // Build kept name→count map to sync rawFunctionCallParts
  const keptCalls = pendingFunctionCalls.slice(0, limit);
  const keptNameCounts = new Map<string, number>();
  for (const fc of keptCalls) {
    keptNameCounts.set(fc.name, (keptNameCounts.get(fc.name) || 0) + 1);
  }

  // Filter rawFunctionCallParts to match kept calls
  const filteredRaw: any[] = [];
  const seenCounts = new Map<string, number>();
  for (const p of rawFunctionCallParts) {
    if (p.functionCall) {
      const name = p.functionCall.name;
      const seen = seenCounts.get(name) || 0;
      const allowed = keptNameCounts.get(name) || 0;
      if (seen < allowed) {
        filteredRaw.push(p);
        seenCounts.set(name, seen + 1);
      }
    }
  }
  rawFunctionCallParts.length = 0;
  rawFunctionCallParts.push(...filteredRaw);

  pendingFunctionCalls.length = limit;
}

// ============================================================================
// Eligibility Check
// ============================================================================

/**
 * Determine if a message should use the fast path.
 */
export function isFastPathEligible(
  group: RegisteredGroup,
  hasMedia: boolean,
): boolean {
  // Globally disabled
  if (!FAST_PATH.ENABLED) return false;

  // Group explicitly disabled
  if (group.enableFastPath === false) return false;

  // Media requires container for multi-modal file processing
  if (hasMedia) return false;

  // API client must be available
  if (!isGeminiClientAvailable()) return false;

  return true;
}

// ============================================================================
// Fast Path Execution
// ============================================================================

export interface FastPathInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  systemPrompt?: string;
  memoryContext?: string;
  enableWebSearch?: boolean;
  /** Disable function calling — only googleSearch remains available.
   *  Used by scheduled tasks to prevent duplicate task creation. */
  disableFunctionCalling?: boolean;
  /** Recent conversation history for multi-turn context */
  conversationHistory?: Array<{ role: 'user' | 'model'; text: string }>;
}

/**
 * Execute a query via the fast path (direct Gemini API).
 *
 * Returns the same ContainerOutput shape for compatibility with
 * the existing message handler.
 */
export async function runFastPath(
  group: RegisteredGroup,
  input: FastPathInput,
  ipcContext: IpcContext,
  onProgress?: (info: ProgressInfo) => void,
): Promise<ContainerOutput> {
  // Wrap in timeout to prevent indefinite hangs
  const timeoutMs = FAST_PATH.TIMEOUT_MS;
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<ContainerOutput>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Fast path timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([
    runFastPathInner(group, input, ipcContext, onProgress).finally(() =>
      clearTimeout(timer!),
    ),
    timeoutPromise,
  ]).catch((err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { group: group.name, err: errorMsg },
      'Fast path: timeout or fatal error',
    );
    return {
      status: 'error' as const,
      result: null,
      error: `Fast path error: ${errorMsg}`,
    };
  });
}

async function runFastPathInner(
  group: RegisteredGroup,
  input: FastPathInput,
  ipcContext: IpcContext,
  onProgress?: (info: ProgressInfo) => void,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const model = (!group.geminiModel || group.geminiModel === 'auto')
    ? getDefaultModel()
    : group.geminiModel;

  logger.info(
    { group: group.name, model, isMain: input.isMain },
    'Fast path: starting direct API execution',
  );

  try {
    // Build system instruction
    let systemInstruction = input.systemPrompt || '';

    // Add follow-up suggestions instruction if enabled
    if ((group as any).enableFollowUp !== false) {
      systemInstruction += `

After your response, if there are natural follow-up questions the user might ask, suggest 2-3 of them on separate lines at the very end of your response, each prefixed with ">>>" (three greater-than signs). For example:
>>> What are the other options?
>>> Can you explain in more detail?
>>> Show me an example
Only suggest follow-ups when they genuinely add value. Do not suggest them for simple greetings or short answers.`;
    }

    // Override any remaining container-specific tool references in GEMINI.md
    if (!input.disableFunctionCalling) {
      systemInstruction += `\n\n## Tool Usage Rules
You are in direct conversation mode. IMPORTANT RULES:
1. ONLY use functions from your function declarations list
2. Do NOT call send_message or mcp__nanoclaw__send_message
3. Do NOT call ANY function unless the user's CURRENT message EXPLICITLY requests that action
4. If the user asks a QUESTION, respond with TEXT only — do NOT call functions
5. NEVER schedule tasks, generate images, or change preferences based on conversation history
6. When in doubt, respond with text instead of calling a function
7. For task-related questions (有幾個/有哪些/列出/查看 tasks), you may call list_tasks to gather info, but NEVER call cancel_task/pause_task/resume_task — those are destructive actions
8. NEVER call cancel_task, pause_task, or resume_task UNLESS the user's current message contains an explicit action verb like 取消/刪除/暫停/恢復/停止`;
    }

    // Fetch query-relevant knowledge (NOT cached — varies per query)
    let knowledgeContent = '';
    try {
      const { getDatabase } = await import('./db.js');
      const { getRelevantKnowledge } = await import('./knowledge.js');
      const db = getDatabase();
      const queryText = input.prompt.replace(/<[^>]*>/g, '').slice(0, 200);
      knowledgeContent = getRelevantKnowledge(db, queryText, input.groupFolder);
    } catch {
      // Knowledge search may fail if no docs exist
    }

    // Cache ONLY static content (system prompt + memory summary).
    // Knowledge is query-dependent and must NOT be cached.
    const cachedContent = await getOrCreateCache(
      input.groupFolder,
      model,
      systemInstruction,
      undefined,
      input.memoryContext,
    );

    // Filter out model messages that are purely function-call artifacts
    // to prevent Gemini from replaying previous function call patterns
    const FUNCTION_RESULT_START_PATTERNS = [
      /^✅\s/, /^⏸️\s/, /^▶️\s/, /^🗑️\s/, /^🎨\s/,  // summarizeFunctionResult outputs
      /^現在的精確時間是\s/,                              // scheduled task time reports
    ];
    // Patterns that indicate function-call artifact content anywhere in text
    const FUNCTION_RESULT_CONTAINS_PATTERNS = [
      /偏好已更新/,
      /定時任務已建立/,
      /任務已暫停/,
      /任務已恢復/,
      /任務已取消/,
      /已經將.*時區.*設定為/,
      /已經.*設定了.*任務/,
      /重新設定了.*任務/,
      /Generated:/,
    ];

    const cleanedHistory = (input.conversationHistory || []).filter((msg) => {
      if (msg.role !== 'model') return true;
      const text = msg.text.trim();
      // Filter messages that start with function result indicators
      if (FUNCTION_RESULT_START_PATTERNS.some((p) => p.test(text))) return false;
      // For short model messages (< 200 chars), also filter if they contain
      // function result artifacts — these are typically auto-generated confirmations
      if (text.length < 200 && FUNCTION_RESULT_CONTAINS_PATTERNS.some((p) => p.test(text))) return false;
      return true;
    });

    // Build content messages with conversation history for multi-turn context
    const contents: Content[] = [];

    if (cleanedHistory.length > 0) {
      for (const msg of cleanedHistory) {
        contents.push({
          role: msg.role as 'user' | 'model',
          parts: [{ text: msg.text }],
        });
      }
    }

    // Inject knowledge into user message (per-query, not cached)
    const userParts: string[] = [];
    if (knowledgeContent) {
      userParts.push(
        `[RELEVANT KNOWLEDGE]\n${knowledgeContent}\n[END RELEVANT KNOWLEDGE]\n`,
      );
    }
    userParts.push(input.prompt);

    contents.push({
      role: 'user' as const,
      parts: [{ text: userParts.join('\n') }],
    });

    // If NOT using cache, inject static context into system instruction
    if (!cachedContent && input.memoryContext) {
      systemInstruction += `\n\n${input.memoryContext}`;
    }

    // Build tools — functionDeclarations and googleSearch are mutually exclusive
    const fnDeclarations = input.disableFunctionCalling
      ? []
      : buildFunctionDeclarations(input.isMain);
    const tools: any[] = [];

    if (fnDeclarations.length > 0) {
      // Function calling takes priority (googleSearch is incompatible)
      tools.push({ functionDeclarations: fnDeclarations });
    } else if (input.enableWebSearch !== false) {
      // Only use googleSearch when no function declarations
      tools.push({ googleSearch: {} });
    }

    // Stream the response (use array for O(n) concatenation instead of O(n²))
    const textParts: string[] = [];
    let fullText = '';
    let promptTokens: number | undefined;
    let responseTokens: number | undefined;
    let lastProgressTime = 0;
    const pendingFunctionCalls: Array<{
      name: string;
      args: Record<string, any>;
    }> = [];
    const rawFunctionCallParts: any[] = [];

    const streamOptions = {
      model,
      systemInstruction: cachedContent ? undefined : systemInstruction,
      contents,
      tools,
      cachedContent: cachedContent || undefined,
    };

    for await (const chunk of streamGenerate(streamOptions)) {
      // Handle text chunks
      if (chunk.text) {
        textParts.push(chunk.text);
        fullText = textParts.join('');

        // Emit progress with throttling
        if (onProgress) {
          const now = Date.now();
          if (now - lastProgressTime >= FAST_PATH.STREAMING_INTERVAL_MS) {
            lastProgressTime = now;
            onProgress({
              type: 'message',
              content: fullText.slice(0, 100),
              contentDelta: chunk.text,
              contentSnapshot: fullText,
              isComplete: false,
            });
          }
        }
      }

      // Collect function calls
      if (chunk.functionCalls) {
        pendingFunctionCalls.push(...chunk.functionCalls);

        // Preserve raw parts for thought signature support (Gemini 3+)
        if (chunk.rawModelParts) {
          rawFunctionCallParts.push(
            ...chunk.rawModelParts.filter((p: any) => p.functionCall),
          );
        }

        // Notify progress about tool use
        if (onProgress) {
          for (const fc of chunk.functionCalls) {
            onProgress({
              type: 'tool_use',
              toolName: fc.name,
            });
          }
        }
      }

      // Capture usage metadata
      if (chunk.usageMetadata) {
        promptTokens = chunk.usageMetadata.promptTokenCount;
        responseTokens = chunk.usageMetadata.candidatesTokenCount;
      }
    }

    // Filter mixed batches: if both read-only and mutating tools are present,
    // drop mutating ones (their args are hallucinated — model hasn't seen list results)
    filterMixedBatch(pendingFunctionCalls, rawFunctionCallParts, group.name);

    // Limit function calls per turn — prioritize read-only tools when truncating
    if (pendingFunctionCalls.length > FAST_PATH.MAX_CALLS_PER_TURN) {
      prioritizedTruncate(
        pendingFunctionCalls,
        rawFunctionCallParts,
        FAST_PATH.MAX_CALLS_PER_TURN,
        group.name,
      );
    }

    // Handle function calls — supports multi-round tool use
    // (e.g., list_tasks → cancel_task requires 2 rounds)
    if (pendingFunctionCalls.length > 0) {
      const allFunctionResults: FunctionCallResult[] = [];

      for (let round = 1; round <= FAST_PATH.MAX_TOOL_ROUNDS; round++) {
        // 1. Execute pending function calls
        const functionResults = await handleFunctionCalls(
          pendingFunctionCalls,
          ipcContext,
          input.groupFolder,
          input.chatJid,
        );
        allFunctionResults.push(...functionResults);

        // 2. Append model function_call + user function_response to contents
        const modelParts =
          rawFunctionCallParts.length > 0
            ? rawFunctionCallParts.slice()
            : pendingFunctionCalls.map((fc) => ({
                functionCall: { name: fc.name, args: fc.args },
              }));

        contents.push(
          {
            role: 'model' as const,
            parts: modelParts,
          },
          {
            role: 'user' as const,
            parts: functionResults.map((fr) => ({
              functionResponse: {
                name: fr.name,
                response: fr.response,
              },
            })),
          },
        );

        // Clear for next round
        pendingFunctionCalls.length = 0;
        rawFunctionCallParts.length = 0;

        // 3. Send results back to Gemini
        // Last round: omit tools to force text-only response
        const isLastRound = round >= FAST_PATH.MAX_TOOL_ROUNDS;
        const followUpOptions = {
          model,
          systemInstruction: cachedContent ? undefined : systemInstruction,
          contents,
          tools: isLastRound ? undefined : tools.length > 0 ? tools : undefined,
          cachedContent: cachedContent || undefined,
        };

        for await (const followChunk of streamGenerate(followUpOptions)) {
          if (followChunk.text) {
            textParts.push(followChunk.text);
            fullText = textParts.join('');

            if (onProgress) {
              const now = Date.now();
              if (now - lastProgressTime >= FAST_PATH.STREAMING_INTERVAL_MS) {
                lastProgressTime = now;
                onProgress({
                  type: 'message',
                  content: fullText.slice(0, 100),
                  contentDelta: followChunk.text,
                  contentSnapshot: fullText,
                  isComplete: false,
                });
              }
            }
          }

          // Collect function calls for next round
          if (followChunk.functionCalls) {
            pendingFunctionCalls.push(...followChunk.functionCalls);

            if (followChunk.rawModelParts) {
              rawFunctionCallParts.push(
                ...followChunk.rawModelParts.filter((p: any) => p.functionCall),
              );
            }

            if (onProgress) {
              for (const fc of followChunk.functionCalls) {
                onProgress({ type: 'tool_use', toolName: fc.name });
              }
            }
          }

          if (followChunk.usageMetadata) {
            promptTokens =
              (promptTokens || 0) +
              (followChunk.usageMetadata.promptTokenCount || 0);
            responseTokens =
              (responseTokens || 0) +
              (followChunk.usageMetadata.candidatesTokenCount || 0);
          }
        }

        // Filter mixed batches in loop rounds too
        filterMixedBatch(pendingFunctionCalls, rawFunctionCallParts, group.name);

        // Limit function calls per turn — prioritize read-only tools
        if (pendingFunctionCalls.length > FAST_PATH.MAX_CALLS_PER_TURN) {
          prioritizedTruncate(
            pendingFunctionCalls,
            rawFunctionCallParts,
            FAST_PATH.MAX_CALLS_PER_TURN,
            group.name,
            round,
          );
        }

        // 4. Got text or no more function calls → done
        if (fullText || pendingFunctionCalls.length === 0) break;

        logger.info(
          { group: group.name, round, nextCalls: pendingFunctionCalls.map(fc => fc.name) },
          'Fast path: continuing to next tool round',
        );
      }

      // Synthesize confirmation if no text was generated across all rounds
      if (!fullText) {
        const summaries = allFunctionResults
          .map((r) => summarizeFunctionResult(r))
          .filter(Boolean);
        if (summaries.length > 0) {
          fullText = summaries.join('\n');
        }
      }
    }

    // Send final completion progress
    if (onProgress && fullText) {
      onProgress({
        type: 'message',
        content: fullText.slice(0, 100),
        contentSnapshot: fullText,
        isComplete: true,
      });
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        group: group.name,
        duration,
        textLength: fullText.length,
        promptTokens,
        responseTokens,
        cached: !!cachedContent,
        functionCalls: pendingFunctionCalls.length,
      },
      'Fast path: completed',
    );

    return {
      status: 'success',
      result: fullText || null,
      promptTokens,
      responseTokens,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    logger.error(
      { group: group.name, duration, err: errorMsg },
      'Fast path: execution error',
    );

    return {
      status: 'error',
      result: null,
      error: `Fast path error: ${errorMsg}`,
    };
  }
}

// ============================================================================
// Function Call Handler
// ============================================================================

/**
 * Generate a user-facing summary for a successful function call result.
 * Used as fallback when Gemini's follow-up produces no text.
 */
function summarizeFunctionResult(result: FunctionCallResult): string {
  const { name, response } = result;

  // Handle failures — surface error to user instead of silent swallow
  if (response.success === false && response.error) {
    return `❌ ${response.error}`;
  }

  switch (name) {
    case 'schedule_task':
      return `✅ 定時任務已建立 (ID: ${response.task_id})`;
    case 'pause_task':
      return `⏸️ 任務已暫停 (ID: ${response.task_id})`;
    case 'resume_task':
      return `▶️ 任務已恢復 (ID: ${response.task_id})`;
    case 'cancel_task':
      return `🗑️ 任務已取消 (ID: ${response.task_id})`;
    case 'generate_image':
      return ''; // Image already sent via bot.sendPhoto
    case 'set_preference':
      return `✅ 偏好已更新: ${response.key}`;
    case 'register_group':
      return `✅ 群組已註冊 (ID: ${response.chat_id})`;
    default:
      return '';
  }
}

async function handleFunctionCalls(
  calls: Array<{ name: string; args: Record<string, any> }>,
  context: IpcContext,
  groupFolder: string,
  chatJid: string,
): Promise<FunctionCallResult[]> {
  const results: FunctionCallResult[] = [];

  for (const call of calls) {
    const result = await executeFunctionCall(
      call.name,
      call.args,
      context,
      groupFolder,
      chatJid,
    );
    results.push(result);
  }

  return results;
}
