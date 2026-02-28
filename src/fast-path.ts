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
      systemInstruction += `\n\n## Tool Usage Rules\nYou are in direct conversation mode. ONLY use the function declarations provided to you. Do NOT call send_message, mcp__nanoclaw__send_message, or any tool not in your function declarations. Always respond with text directly to the user.`;
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
    const FUNCTION_RESULT_PATTERNS = [
      /^✅\s/, /^⏸️\s/, /^▶️\s/, /^🗑️\s/, /^🎨\s/,  // summarizeFunctionResult outputs
      /^現在的精確時間是\s/,                              // scheduled task time reports
    ];

    const cleanedHistory = (input.conversationHistory || []).filter((msg) => {
      if (msg.role !== 'model') return true;
      // Keep model messages that have substantial text (not just function results)
      return !FUNCTION_RESULT_PATTERNS.some((pattern) => pattern.test(msg.text.trim()));
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

    // Handle function calls if any
    if (pendingFunctionCalls.length > 0) {
      const functionResults = await handleFunctionCalls(
        pendingFunctionCalls,
        ipcContext,
        input.groupFolder,
        input.chatJid,
      );

      // Send function results back to model for final response
      // Use raw parts when available to preserve thoughtSignature (Gemini 3+)
      const modelParts =
        rawFunctionCallParts.length > 0
          ? rawFunctionCallParts
          : pendingFunctionCalls.map((fc) => ({
              functionCall: { name: fc.name, args: fc.args },
            }));

      const followUpContents: Content[] = [
        ...contents,
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
      ];

      // Stream follow-up response after function calls
      // Omit tools — force text-only response after function results.
      // Follow-up stream only captures text; function calls were silently dropped.
      const followUpOptions = {
        model,
        systemInstruction: cachedContent ? undefined : systemInstruction,
        contents: followUpContents,
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

        if (followChunk.usageMetadata) {
          promptTokens =
            (promptTokens || 0) +
            (followChunk.usageMetadata.promptTokenCount || 0);
          responseTokens =
            (responseTokens || 0) +
            (followChunk.usageMetadata.candidatesTokenCount || 0);
        }
      }

      // If function calls succeeded but no text was generated,
      // synthesize a confirmation so message-handler doesn't treat it as error.
      if (!fullText) {
        const summaries = functionResults
          .filter((r) => r.response.success)
          .map((r) => summarizeFunctionResult(r))
          .filter(Boolean);
        if (summaries.length > 0) {
          fullText = summaries.join('\n');
        }
      }

      // If ALL function calls failed and still no text, retry without tools
      // to force a plain text response (e.g. Gemini hallucinated send_message)
      if (!fullText) {
        logger.warn(
          { group: group.name, failedCalls: pendingFunctionCalls.map(fc => fc.name) },
          'Fast path: all function calls produced no text, retrying without tools',
        );
        const retryOptions = {
          model,
          systemInstruction: cachedContent ? undefined : systemInstruction,
          contents,  // Original contents (without function call results)
          cachedContent: cachedContent || undefined,
        };
        for await (const retryChunk of streamGenerate(retryOptions)) {
          if (retryChunk.text) {
            textParts.push(retryChunk.text);
            fullText = textParts.join('');
          }
          if (retryChunk.usageMetadata) {
            promptTokens = (promptTokens || 0) + (retryChunk.usageMetadata.promptTokenCount || 0);
            responseTokens = (responseTokens || 0) + (retryChunk.usageMetadata.candidatesTokenCount || 0);
          }
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
