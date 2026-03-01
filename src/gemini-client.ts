/**
 * Gemini API Client - Direct API integration with dual auth support.
 *
 * Auth paths:
 * - API key: uses @google/genai SDK (full features: streaming, caching, function calling)
 * - OAuth: uses REST API directly (streaming, function calling; caching skipped — OAuth is free)
 *
 * The @google/genai SDK requires `apiKey` in non-Vertex mode and cannot be
 * initialized with just a Bearer token. For OAuth, we bypass the SDK and
 * call the Vertex AI REST API with `fetch()`, since the Gemini CLI's OAuth
 * grants `cloud-platform` scope (accepted by Vertex AI, not by consumer API).
 */

import { GoogleGenAI, type Content } from '@google/genai';
import { resolveAuth, isAuthAvailable, buildVertexUrl } from './auth.js';
import { logger } from './logger.js';

// ============================================================================
// SDK Client (API key only)
// ============================================================================

let clientInstance: GoogleGenAI | null = null;

/**
 * Get or create the GoogleGenAI SDK client.
 * Returns null if no API key is available (OAuth uses REST path instead).
 *
 * Note: This is async because it calls resolveAuth() which may refresh tokens.
 * For OAuth-only setups, this returns null — callers should use the REST path.
 */
export async function getGeminiClient(): Promise<GoogleGenAI | null> {
  const auth = await resolveAuth();
  if (!auth || auth.type !== 'apikey') return null;

  if (clientInstance) return clientInstance;

  clientInstance = new GoogleGenAI({ apiKey: auth.apiKey });
  logger.info('Gemini API client initialized (apikey)');
  return clientInstance;
}

/**
 * Check if the Gemini direct API client is available.
 * Synchronous — checks credential existence without refresh.
 * Returns true for both API key and OAuth.
 */
export function isGeminiClientAvailable(): boolean {
  return isAuthAvailable();
}

// ============================================================================
// Types
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
  /** Raw model parts from the API response, preserved for thought signature continuity (Gemini 3+) */
  rawModelParts?: any[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// ============================================================================
// Streaming Generation
// ============================================================================

/**
 * Generate content with streaming support.
 * Routes to SDK or REST API based on available auth.
 */
export async function* streamGenerate(
  options: StreamGenerateOptions,
): AsyncGenerator<StreamChunk> {
  const auth = await resolveAuth();
  if (!auth) {
    throw new Error('Gemini API client not available');
  }

  if (auth.type === 'apikey') {
    yield* streamGenerateWithSdk(options, auth.apiKey);
  } else {
    yield* streamGenerateWithRest(options, auth.token, auth.project);
  }
}

/**
 * Generate content without streaming (for function call follow-ups).
 * Routes to SDK or REST API based on available auth.
 */
export async function generate(
  options: StreamGenerateOptions & { contents: Content[] },
): Promise<{
  text?: string;
  functionCalls?: Array<{ name: string; args: Record<string, any> }>;
  usageMetadata?: StreamChunk['usageMetadata'];
}> {
  const auth = await resolveAuth();
  if (!auth) {
    throw new Error('Gemini API client not available');
  }

  if (auth.type === 'apikey') {
    return generateWithSdk(options, auth.apiKey);
  } else {
    return generateWithRest(options, auth.token, auth.project);
  }
}

// ============================================================================
// SDK Path (API key)
// ============================================================================

function getSdkClient(apiKey: string): GoogleGenAI {
  if (clientInstance) return clientInstance;
  clientInstance = new GoogleGenAI({ apiKey });
  logger.info('Gemini API client initialized (apikey)');
  return clientInstance;
}

async function* streamGenerateWithSdk(
  options: StreamGenerateOptions,
  apiKey: string,
): AsyncGenerator<StreamChunk> {
  const client = getSdkClient(apiKey);

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

    if (chunk.text) {
      result.text = chunk.text;
    }

    if (chunk.functionCalls && chunk.functionCalls.length > 0) {
      result.functionCalls = chunk.functionCalls.map((fc) => ({
        name: fc.name!,
        args: (fc.args as Record<string, any>) || {},
      }));

      const rawParts = chunk.candidates?.[0]?.content?.parts;
      if (rawParts) {
        result.rawModelParts = rawParts;
      }
    }

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

async function generateWithSdk(
  options: StreamGenerateOptions & { contents: Content[] },
  apiKey: string,
): Promise<{
  text?: string;
  functionCalls?: Array<{ name: string; args: Record<string, any> }>;
  usageMetadata?: StreamChunk['usageMetadata'];
}> {
  const client = getSdkClient(apiKey);

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

  const result: {
    text?: string;
    functionCalls?: Array<{ name: string; args: Record<string, any> }>;
    usageMetadata?: StreamChunk['usageMetadata'];
  } = {};

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

// ============================================================================
// REST API Path (OAuth)
// ============================================================================

/**
 * Build the REST API request body from StreamGenerateOptions.
 */
function buildRestBody(options: StreamGenerateOptions): Record<string, any> {
  const body: Record<string, any> = {
    contents: options.contents,
  };

  if (options.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: options.systemInstruction }],
    };
  }

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  if (options.cachedContent) {
    body.cachedContent = options.cachedContent;
  }

  return body;
}

/**
 * Parse a REST API response chunk into a StreamChunk.
 */
function parseRestChunk(data: any): StreamChunk | null {
  const result: StreamChunk = {};

  const candidate = data.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        result.text = (result.text || '') + part.text;
      }
      if (part.functionCall) {
        if (!result.functionCalls) result.functionCalls = [];
        result.functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }

    // Preserve raw parts for thought signature support (Gemini 3+)
    if (result.functionCalls) {
      result.rawModelParts = candidate.content.parts;
    }
  }

  if (data.usageMetadata) {
    result.usageMetadata = {
      promptTokenCount: data.usageMetadata.promptTokenCount ?? undefined,
      candidatesTokenCount:
        data.usageMetadata.candidatesTokenCount ?? undefined,
      totalTokenCount: data.usageMetadata.totalTokenCount ?? undefined,
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}

const VERTEX_FALLBACK_MODEL = 'gemini-2.5-flash';

async function* streamGenerateWithRest(
  options: StreamGenerateOptions,
  token: string,
  project: string,
): AsyncGenerator<StreamChunk> {
  let model = options.model;
  const url = buildVertexUrl(project, model, 'streamGenerateContent', true);
  const body = buildRestBody(options);

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  // 404 safety net: retry with a known-good fallback model
  if (response.status === 404 && model !== VERTEX_FALLBACK_MODEL) {
    logger.warn(
      { model, fallback: VERTEX_FALLBACK_MODEL },
      'Model not found on Vertex AI, retrying with fallback',
    );
    model = VERTEX_FALLBACK_MODEL;
    const retryUrl = buildVertexUrl(
      project,
      model,
      'streamGenerateContent',
      true,
    );
    response = await fetch(retryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini API error: ${response.status} - ${errorText.slice(0, 200)}`,
    );
  }

  // Parse Server-Sent Events stream
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const data = JSON.parse(jsonStr);
        const chunk = parseRestChunk(data);
        if (chunk) yield chunk;
      } catch {
        // Skip malformed JSON
      }
    }
  }

  // Process remaining buffer
  if (buffer.startsWith('data: ')) {
    const jsonStr = buffer.slice(6).trim();
    if (jsonStr && jsonStr !== '[DONE]') {
      try {
        const data = JSON.parse(jsonStr);
        const chunk = parseRestChunk(data);
        if (chunk) yield chunk;
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

async function generateWithRest(
  options: StreamGenerateOptions & { contents: Content[] },
  token: string,
  project: string,
): Promise<{
  text?: string;
  functionCalls?: Array<{ name: string; args: Record<string, any> }>;
  usageMetadata?: StreamChunk['usageMetadata'];
}> {
  let model = options.model;
  const url = buildVertexUrl(project, model, 'generateContent');
  const body = buildRestBody(options);

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  // 404 safety net: retry with a known-good fallback model
  if (response.status === 404 && model !== VERTEX_FALLBACK_MODEL) {
    logger.warn(
      { model, fallback: VERTEX_FALLBACK_MODEL },
      'Model not found on Vertex AI, retrying with fallback',
    );
    model = VERTEX_FALLBACK_MODEL;
    const retryUrl = buildVertexUrl(project, model, 'generateContent');
    response = await fetch(retryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini API error: ${response.status} - ${errorText.slice(0, 200)}`,
    );
  }

  const data = await response.json();
  return parseRestChunk(data) || {};
}
