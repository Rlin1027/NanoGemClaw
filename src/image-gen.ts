/**
 * Image Generation Module
 *
 * Generates images using Gemini's generateContent API with image output.
 * Supports both API key and OAuth authentication.
 * Auth priority: GEMINI_API_KEY env → OAuth token from ~/.gemini/oauth_creds.json
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { logger } from './logger.js';

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = 'gemini-2.0-flash-preview-image-generation';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OAUTH_CREDS_PATH = path.join(os.homedir(), '.gemini', 'oauth_creds.json');

interface ImageGenerationResult {
  success: boolean;
  imagePath?: string;
  error?: string;
}

interface OAuthCreds {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content: {
      parts: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
      }>;
    };
  }>;
  error?: {
    message: string;
  };
}

function readOAuthCreds(): OAuthCreds | null {
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

function isTokenExpired(creds: OAuthCreds): boolean {
  if (!creds.expires_at) return false;
  // Consider expired if less than 60s remaining
  return Date.now() >= creds.expires_at * 1000 - 60_000;
}

function refreshTokenViaCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('gemini', ['-p', '.', '--output-format', 'text'], {
      stdio: 'pipe',
      timeout: 15_000,
    });
    proc.on('close', () => resolve(true));
    proc.on('error', () => resolve(false));
  });
}

async function getAuth(): Promise<{ header: string; key: string } | null> {
  // Priority 1: API key from environment
  if (GEMINI_API_KEY) {
    return { header: `x-goog-api-key`, key: GEMINI_API_KEY };
  }

  // Priority 2: OAuth token
  let creds = readOAuthCreds();
  if (!creds) return null;

  if (isTokenExpired(creds)) {
    logger.info('OAuth token expired, refreshing via Gemini CLI');
    const ok = await refreshTokenViaCli();
    if (!ok) {
      logger.warn('Failed to refresh OAuth token via CLI');
      return null;
    }
    creds = readOAuthCreds();
    if (!creds) return null;
  }

  return { header: 'Authorization', key: `Bearer ${creds.access_token}` };
}

/**
 * Generate an image using Gemini generateContent API
 */
export async function generateImage(
  prompt: string,
  outputDir: string,
  _options: {
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    numberOfImages?: number;
  } = {},
): Promise<ImageGenerationResult> {
  const auth = await getAuth();
  if (!auth) {
    return {
      success: false,
      error:
        'No authentication available (set GEMINI_API_KEY or login with gemini CLI)',
    };
  }

  const startTime = Date.now();
  const url = `${API_BASE}/models/${MODEL}:generateContent`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [auth.header]: auth.key,
    };

    const body = {
      contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API error: ${response.status} - ${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as GenerateContentResponse;

    if (data.error) {
      throw new Error(data.error.message);
    }

    // Find the image part in response
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts) {
      throw new Error('No content in response');
    }

    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData) {
      throw new Error('No image generated in response');
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const ext =
      mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';

    // Create output directory if needed
    fs.mkdirSync(outputDir, { recursive: true });

    // Generate unique filename
    const timestamp = Date.now();
    const safePrompt = prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `gen_${timestamp}_${safePrompt}.${ext}`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFileSync(filePath, imageBuffer);

    logger.info(
      {
        duration: Date.now() - startTime,
        prompt: prompt.slice(0, 50),
        path: filePath,
        authType: auth.header === 'Authorization' ? 'oauth' : 'apikey',
      },
      'Image generated',
    );

    return {
      success: true,
      imagePath: filePath,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, prompt: prompt.slice(0, 50) },
      'Failed to generate image',
    );

    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if image generation is available
 */
export function isImageGenAvailable(): boolean {
  if (GEMINI_API_KEY) return true;
  const creds = readOAuthCreds();
  return creds !== null;
}
