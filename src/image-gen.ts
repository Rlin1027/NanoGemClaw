/**
 * Image Generation Module
 *
 * Generates images using Gemini's generateContent API with image output.
 * Supports both API key and OAuth authentication via the shared auth module.
 * Auth priority: OAuth → GEMINI_API_KEY → GOOGLE_API_KEY
 */

import fs from 'fs';
import path from 'path';
import { resolveAuth, resolveApiKeyAuth, isAuthAvailable } from './auth.js';
import { logger } from './logger.js';

// Configuration
const MODEL = 'gemini-3.1-flash-image-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface ImageGenerationResult {
  success: boolean;
  imagePath?: string;
  error?: string;
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

/**
 * Generate an image using Gemini generateContent API
 */
export async function generateImage(
  prompt: string,
  outputDir: string,
  options: {
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    numberOfImages?: number;
  } = {},
): Promise<ImageGenerationResult> {
  const auth = await resolveAuth();
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
      ...(auth.type === 'apikey'
        ? { 'x-goog-api-key': auth.apiKey }
        : { Authorization: `Bearer ${auth.token}` }),
    };

    const body = {
      contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: {
          aspectRatio: options.aspectRatio || '1:1',
        },
      },
    };

    let response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    // OAuth 403: cloud-platform scope doesn't cover consumer API image generation.
    // Retry with API key if available.
    if (response.status === 403 && auth.type === 'oauth') {
      const apiKeyAuth = resolveApiKeyAuth();
      if (apiKeyAuth) {
        logger.info('OAuth 403 on image generation, retrying with API key');
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKeyAuth.apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
      }
    }

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
        authType: auth.type,
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
      { err: errorMessage, prompt: prompt.slice(0, 50) },
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
  return isAuthAvailable();
}
