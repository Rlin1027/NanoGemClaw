/**
 * Gemini API Client - Direct API integration using @google/genai SDK.
 *
 * Provides streaming generation, context caching, and function calling
 * as an alternative to container-based execution for simple queries.
 */

import { GoogleGenAI, type Content } from '@google/genai';
import { logger } from './logger.js';

// ============================================================================
// Authentication
// ============================================================================

/**
 * Resolve the API key for Gemini.
 * Priority: GEMINI_API_KEY env → GOOGLE_API_KEY env
 *
 * Note: OAuth tokens are NOT supported by the @google/genai SDK's apiKey param.
 * OAuth auth requires a different SDK configuration (e.g. Vertex AI).
 * For OAuth-only setups, the fast path will be unavailable and container
 * path (which uses the gemini CLI with OAuth) will be used instead.
 */
export function resolveApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

// ============================================================================
// Client Singleton
// ============================================================================

let clientInstance: GoogleGenAI | null = null;

/**
 * Get or create the GoogleGenAI client singleton.
 * Returns null if no API key is available.
 */
export function getGeminiClient(): GoogleGenAI | null {
  if (clientInstance) return clientInstance;

  const apiKey = resolveApiKey();
  if (!apiKey) {
    logger.warn('No Gemini API key available for direct API calls');
    return null;
  }

  clientInstance = new GoogleGenAI({ apiKey });
  logger.info('Gemini API client initialized');
  return clientInstance;
}

/**
 * Check if the Gemini direct API client is available.
 */
export function isGeminiClientAvailable(): boolean {
  return resolveApiKey() !== null;
}

// ============================================================================
// Streaming Generation
// ============================================================================

export interface StreamGenerateOptions {
  model: string;
  systemInstruction?: string;
  contents: Content[];
  tools?: any[];
  cachedContent?: string;
}

export interface StreamChunk {
  text?: string;
  functionCalls?: Array<{ name: string; args: Record<string, any> }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Generate content with streaming support.
 * Yields chunks as they arrive from the API.
 */
export async function* streamGenerate(
  options: StreamGenerateOptions,
): AsyncGenerator<StreamChunk> {
  const client = getGeminiClient();
  if (!client) {
    throw new Error('Gemini API client not available');
  }

  const config: Record<string, any> = {};
  if (options.systemInstruction) {
    config.systemInstruction = options.systemInstruction;
  }
  if (options.tools && options.tools.length > 0) {
    config.tools = options.tools;
  }
  if (options.cachedContent) {
    config.cachedContent = options.cachedContent;
  }

  const response = await client.models.generateContentStream({
    model: options.model,
    contents: options.contents,
    config,
  });

  for await (const chunk of response) {
    const result: StreamChunk = {};

    // Extract text
    if (chunk.text) {
      result.text = chunk.text;
    }

    // Extract function calls
    if (chunk.functionCalls && chunk.functionCalls.length > 0) {
      result.functionCalls = chunk.functionCalls.map((fc) => ({
        name: fc.name!,
        args: (fc.args as Record<string, any>) || {},
      }));
    }

    // Extract usage metadata (usually on last chunk)
    if (chunk.usageMetadata) {
      result.usageMetadata = {
        promptTokenCount: chunk.usageMetadata.promptTokenCount ?? undefined,
        candidatesTokenCount:
          chunk.usageMetadata.candidatesTokenCount ?? undefined,
        totalTokenCount: chunk.usageMetadata.totalTokenCount ?? undefined,
      };
    }

    yield result;
  }
}

/**
 * Generate content without streaming (for function call follow-ups).
 */
export async function generate(
  options: StreamGenerateOptions & { contents: Content[] },
): Promise<{
  text?: string;
  functionCalls?: Array<{ name: string; args: Record<string, any> }>;
  usageMetadata?: StreamChunk['usageMetadata'];
}> {
  const client = getGeminiClient();
  if (!client) {
    throw new Error('Gemini API client not available');
  }

  const config: Record<string, any> = {};
  if (options.systemInstruction) {
    config.systemInstruction = options.systemInstruction;
  }
  if (options.tools && options.tools.length > 0) {
    config.tools = options.tools;
  }
  if (options.cachedContent) {
    config.cachedContent = options.cachedContent;
  }

  const response = await client.models.generateContent({
    model: options.model,
    contents: options.contents,
    config,
  });

  const result: ReturnType<typeof generate> extends Promise<infer R>
    ? R
    : never = {};

  if (response.text) {
    result.text = response.text;
  }

  if (response.functionCalls && response.functionCalls.length > 0) {
    result.functionCalls = response.functionCalls.map((fc) => ({
      name: fc.name!,
      args: (fc.args as Record<string, any>) || {},
    }));
  }

  if (response.usageMetadata) {
    result.usageMetadata = {
      promptTokenCount: response.usageMetadata.promptTokenCount ?? undefined,
      candidatesTokenCount:
        response.usageMetadata.candidatesTokenCount ?? undefined,
      totalTokenCount: response.usageMetadata.totalTokenCount ?? undefined,
    };
  }

  return result;
}
