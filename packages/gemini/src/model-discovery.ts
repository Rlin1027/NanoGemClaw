/**
 * Model Discovery Service — queries the Gemini API for available models.
 *
 * Features:
 * - Fetches all models supporting generateContent (filters out embedding-only, etc.)
 * - Classifies models by family (flash, pro, etc.)
 * - In-memory cache with 24h TTL to avoid redundant API calls
 * - Graceful fallback to a hardcoded list when the API is unreachable
 */

import { getGeminiClient } from './gemini-client.js';
import { logger } from '@nanogemclaw/core/logger';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredModel {
  /** Full model ID, e.g. "gemini-3-flash-preview" */
  id: string;
  /** Human-readable name, e.g. "Gemini 3 Flash Preview" */
  displayName: string;
  /** Family tag: "flash" | "pro" | "ultra" | "other" */
  family: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

// ============================================================================
// Fallback list (used when the API is unreachable)
// ============================================================================

const FALLBACK_MODELS: DiscoveredModel[] = [
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    family: 'flash',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    id: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    family: 'pro',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
];

// ============================================================================
// Cache
// ============================================================================

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cachedModels: DiscoveredModel[] = [];
let cacheTimestamp = 0;

function isCacheValid(): boolean {
  return cachedModels.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

// ============================================================================
// Family Classification
// ============================================================================

function classifyFamily(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (lower.includes('flash')) return 'flash';
  if (lower.includes('pro')) return 'pro';
  if (lower.includes('ultra')) return 'ultra';
  return 'other';
}

/**
 * Strip the "models/" prefix that the API sometimes returns.
 * e.g. "models/gemini-3-flash-preview" → "gemini-3-flash-preview"
 */
function normalizeModelId(name: string): string {
  return name.startsWith('models/') ? name.slice(7) : name;
}

// ============================================================================
// Core API
// ============================================================================

/**
 * Fetch all available Gemini models from the API.
 * Results are cached for 24 hours.
 * Falls back to a hardcoded list on failure.
 */
export async function discoverModels(): Promise<DiscoveredModel[]> {
  if (isCacheValid()) return cachedModels;

  const client = getGeminiClient();
  if (!client) {
    logger.warn('No Gemini client available for model discovery, using fallback list');
    cachedModels = FALLBACK_MODELS;
    cacheTimestamp = Date.now();
    return cachedModels;
  }

  try {
    const discovered: DiscoveredModel[] = [];
    const pager = await client.models.list({ config: { pageSize: 100 } });

    for await (const model of pager) {
      const name = model.name;
      if (!name) continue;

      const id = normalizeModelId(name);

      // Only include gemini models (skip tuned, embedding-only, imagen, etc.)
      if (!id.startsWith('gemini-')) continue;

      // Only include models that support generateContent
      const actions = model.supportedActions ?? [];
      if (actions.length > 0 && !actions.includes('generateContent')) continue;

      discovered.push({
        id,
        displayName: model.displayName || id,
        family: classifyFamily(id),
        inputTokenLimit: model.inputTokenLimit ?? undefined,
        outputTokenLimit: model.outputTokenLimit ?? undefined,
      });
    }

    if (discovered.length === 0) {
      logger.warn('Model discovery returned no gemini models, using fallback list');
      cachedModels = FALLBACK_MODELS;
    } else {
      // Sort: flash first, then pro, then others; within each family sort by name descending (newest first)
      discovered.sort((a, b) => {
        const familyOrder: Record<string, number> = { flash: 0, pro: 1, ultra: 2, other: 3 };
        const fa = familyOrder[a.family] ?? 3;
        const fb = familyOrder[b.family] ?? 3;
        if (fa !== fb) return fa - fb;
        return b.id.localeCompare(a.id);
      });
      cachedModels = discovered;
    }

    cacheTimestamp = Date.now();
    logger.info({ count: cachedModels.length }, 'Model discovery completed');
    return cachedModels;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, 'Model discovery failed, using fallback list');
    cachedModels = FALLBACK_MODELS;
    cacheTimestamp = Date.now();
    return cachedModels;
  }
}

/**
 * Inject externally-discovered models into the cache.
 * Used by OAuth/Vertex AI path where the SDK is unavailable.
 */
export function setExternalModels(models: DiscoveredModel[]): void {
  cachedModels = models;
  cacheTimestamp = Date.now();
}

/**
 * Synchronous access to the cached model list.
 * Returns an empty array if `discoverModels()` has never been called.
 * Returns the fallback list otherwise.
 */
export function getAvailableModels(): DiscoveredModel[] {
  return cachedModels.length > 0 ? cachedModels : FALLBACK_MODELS;
}

/**
 * Resolve the latest model ID for a given family (default: "flash").
 * Returns the first model in that family from the sorted cache.
 */
export function resolveLatestModel(family: string = 'flash'): string {
  const models = getAvailableModels();
  const match = models.find((m) => m.family === family);
  return match?.id ?? 'gemini-2.5-flash';
}

/**
 * Invalidate the model cache so the next `discoverModels()` call
 * re-fetches from the API.
 */
export function invalidateModelCache(): void {
  cacheTimestamp = 0;
}

// For testing
export { FALLBACK_MODELS };
