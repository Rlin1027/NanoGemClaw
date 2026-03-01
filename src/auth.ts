/**
 * Shared Authentication Module
 *
 * Provides unified auth resolution for both fast path (Gemini SDK)
 * and image generation (REST API). Supports API key and OAuth.
 *
 * Auth priority (chat/fast path): OAuth → GEMINI_API_KEY → GOOGLE_API_KEY
 * Design: OAuth is preferred because it's free (tied to Google Cloud account),
 * while API keys incur billing. Even if env has an API key set, chat still
 * prefers OAuth. API key serves as fallback (OAuth not set or refresh fails).
 *
 * OAuth uses the Vertex AI endpoint (aiplatform.googleapis.com) because:
 * - The consumer API (generativelanguage.googleapis.com) requires the
 *   `generative-language` scope, which the Gemini CLI doesn't grant.
 * - Gemini CLI's OAuth grants `cloud-platform` scope, which works with Vertex AI.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface OAuthCreds {
  access_token: string;
  refresh_token?: string;
  /** Expiry in seconds (legacy image-gen format) */
  expires_at?: number;
  /** Expiry in milliseconds (Gemini CLI format) */
  expiry_date?: number;
}

export type AuthResult =
  | { type: 'oauth'; token: string; project: string }
  | { type: 'apikey'; apiKey: string };

// ============================================================================
// OAuth Credentials
// ============================================================================

const OAUTH_CREDS_PATH = path.join(os.homedir(), '.gemini', 'oauth_creds.json');

/**
 * Read OAuth credentials from ~/.gemini/oauth_creds.json.
 */
export function readOAuthCreds(): OAuthCreds | null {
  try {
    if (!fs.existsSync(OAUTH_CREDS_PATH)) return null;
    const raw = fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8');
    const creds = JSON.parse(raw) as OAuthCreds;
    if (!creds.access_token) return null;
    return creds;
  } catch {
    return null;
  }
}

/**
 * Check if an OAuth token is expired (with 60s buffer).
 * Supports both `expires_at` (seconds) and `expiry_date` (milliseconds).
 */
export function isTokenExpired(creds: OAuthCreds): boolean {
  // Gemini CLI uses expiry_date (milliseconds)
  if (creds.expiry_date) {
    return Date.now() >= creds.expiry_date - 60_000;
  }
  // Legacy format: expires_at (seconds)
  if (creds.expires_at) {
    return Date.now() >= creds.expires_at * 1000 - 60_000;
  }
  // No expiry info — assume valid (will get 401 if not, triggering refresh)
  return false;
}

/**
 * Refresh OAuth token by invoking the Gemini CLI.
 * The CLI reads refresh_token from oauth_creds.json and writes back
 * a new access_token + expiry_date.
 */
export function refreshTokenViaCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('gemini', ['-p', '.', '--output-format', 'text'], {
      stdio: 'pipe',
      timeout: 15_000,
    });
    proc.on('close', () => resolve(true));
    proc.on('error', () => resolve(false));
  });
}

// ============================================================================
// Google Cloud Project Discovery
// ============================================================================

let cachedProject: string | null = null;

/**
 * Discover the Google Cloud project ID for Vertex AI.
 * Priority: GOOGLE_CLOUD_PROJECT env → GCLOUD_PROJECT env → Cloud Resource Manager API
 */
export async function discoverProject(token: string): Promise<string | null> {
  if (cachedProject) return cachedProject;

  // 1. Environment variables
  const envProject =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (envProject) {
    cachedProject = envProject;
    return cachedProject;
  }

  // 2. Auto-discover via Cloud Resource Manager API
  try {
    const url =
      'https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=1';
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const data = (await r.json()) as {
        projects?: Array<{ projectId: string }>;
      };
      const proj = data.projects?.[0];
      if (proj) {
        cachedProject = proj.projectId;
        logger.info(
          { project: cachedProject },
          'Auto-discovered Google Cloud project for OAuth',
        );
        return cachedProject;
      }
    }
  } catch {
    // Ignore — project discovery is best-effort
  }

  return null;
}

// ============================================================================
// Vertex AI Endpoint
// ============================================================================

const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'global';

/**
 * Build the Vertex AI base URL for a given model and method.
 *
 * Global endpoint (default): https://aiplatform.googleapis.com/v1beta1/projects/.../locations/global/...
 * Regional endpoint: https://{region}-aiplatform.googleapis.com/v1beta1/projects/.../locations/{region}/...
 *
 * Preview/experimental models are only available on the global endpoint.
 * See: https://github.com/google-gemini/gemini-cli/issues/19055
 */
export function buildVertexUrl(
  project: string,
  model: string,
  method: 'generateContent' | 'streamGenerateContent',
  streaming?: boolean,
): string {
  const location = VERTEX_LOCATION;
  // Global endpoint has no region prefix in hostname; regional endpoints do
  const host =
    location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${location}-aiplatform.googleapis.com`;
  const base = `https://${host}/v1beta1`;
  const resourcePath = `projects/${project}/locations/${location}/publishers/google/models/${model}:${method}`;
  const suffix = streaming ? '?alt=sse' : '';
  return `${base}/${resourcePath}${suffix}`;
}

// ============================================================================
// Unified Auth Resolution
// ============================================================================

/**
 * Resolve authentication credentials.
 * Priority: OAuth → GEMINI_API_KEY → GOOGLE_API_KEY
 *
 * Returns null if no auth is available.
 * For OAuth, also resolves the Google Cloud project ID for Vertex AI.
 */
export async function resolveAuth(): Promise<AuthResult | null> {
  // 1. OAuth (preferred — free, tied to Google Cloud account)
  let creds = readOAuthCreds();
  if (creds) {
    if (isTokenExpired(creds)) {
      logger.info('OAuth token expired, refreshing via Gemini CLI');
      const ok = await refreshTokenViaCli();
      if (!ok) {
        logger.warn('Failed to refresh OAuth token via CLI');
        // Fall through to API key
      } else {
        creds = readOAuthCreds();
      }
    }
    if (creds && !isTokenExpired(creds)) {
      const project = await discoverProject(creds.access_token);
      if (project) {
        return { type: 'oauth', token: creds.access_token, project };
      }
      logger.warn(
        'OAuth credentials found but no Google Cloud project available. ' +
          'Set GOOGLE_CLOUD_PROJECT env var or create a project at console.cloud.google.com',
      );
      // Fall through to API key
    }
  }

  // 2. Fallback to API key
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) return { type: 'apikey', apiKey };

  return null;
}

// ============================================================================
// Vertex AI Model Discovery
// ============================================================================

export interface VertexModel {
  id: string;
  displayName: string;
  family: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/**
 * Discover models available on Vertex AI via REST API.
 * Filters for gemini-* models that support generateContent.
 */
export async function discoverVertexModels(
  token: string,
  _project: string,
): Promise<VertexModel[]> {
  const location = process.env.VERTEX_AI_LOCATION || 'global';
  const host =
    location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1beta1/publishers/google/models`;

  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      logger.warn({ status: r.status }, 'Vertex AI model listing failed');
      return [];
    }

    const data = (await r.json()) as {
      models?: Array<{
        name?: string;
        displayName?: string;
        supportedActions?: string[];
        inputTokenLimit?: number;
        outputTokenLimit?: number;
      }>;
    };

    if (!data.models) return [];

    const models: VertexModel[] = [];
    for (const m of data.models) {
      if (!m.name) continue;
      // Extract model ID from full resource name
      // e.g. "publishers/google/models/gemini-2.5-flash" → "gemini-2.5-flash"
      const id = m.name.includes('/') ? m.name.split('/').pop()! : m.name;
      if (!id.startsWith('gemini-')) continue;

      // Only include models that support generateContent
      const actions = m.supportedActions ?? [];
      if (actions.length > 0 && !actions.includes('generateContent')) continue;

      const lower = id.toLowerCase();
      let family = 'other';
      if (lower.includes('flash')) family = 'flash';
      else if (lower.includes('pro')) family = 'pro';
      else if (lower.includes('ultra')) family = 'ultra';

      models.push({
        id,
        displayName: m.displayName || id,
        family,
        inputTokenLimit: m.inputTokenLimit,
        outputTokenLimit: m.outputTokenLimit,
      });
    }

    // Sort: flash first, then pro, then others; within family by name desc
    models.sort((a, b) => {
      const order: Record<string, number> = {
        flash: 0,
        pro: 1,
        ultra: 2,
        other: 3,
      };
      const fa = order[a.family] ?? 3;
      const fb = order[b.family] ?? 3;
      if (fa !== fb) return fa - fb;
      return b.id.localeCompare(a.id);
    });

    logger.info(
      { count: models.length },
      'Vertex AI model discovery completed',
    );
    return models;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Vertex AI model discovery failed',
    );
    return [];
  }
}

// ============================================================================
// API Key Only Auth
// ============================================================================

/**
 * Resolve API key authentication only (ignoring OAuth).
 * Used for endpoints that require API key auth (e.g. consumer API image generation).
 * OAuth's cloud-platform scope doesn't cover generativelanguage.googleapis.com.
 */
export function resolveApiKeyAuth(): { type: 'apikey'; apiKey: string } | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) return { type: 'apikey', apiKey };
  return null;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Synchronous check: is any form of authentication available?
 * Does NOT validate token expiry or attempt refresh.
 */
export function isAuthAvailable(): boolean {
  return (
    readOAuthCreds() !== null ||
    !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
  );
}
