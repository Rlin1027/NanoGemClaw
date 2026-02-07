/**
 * Image Generation Module
 *
 * Generates images using Google's Imagen 3 API via the Gemini API.
 * Images are saved to the group's media folder and can be sent to Telegram.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const IMAGEN_MODEL = 'imagen-3.0-generate-002';
const IMAGEN_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:generateImages`;

interface ImageGenerationResult {
    success: boolean;
    imagePath?: string;
    error?: string;
}

interface ImagenResponse {
    generatedImages?: Array<{
        image: {
            imageBytes: string;
        };
    }>;
    error?: {
        message: string;
    };
}

/**
 * Generate an image using Imagen 3 API
 */
export async function generateImage(
    prompt: string,
    outputDir: string,
    options: {
        aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
        numberOfImages?: number;
    } = {},
): Promise<ImageGenerationResult> {
    if (!GEMINI_API_KEY) {
        return {
            success: false,
            error: 'GEMINI_API_KEY not configured',
        };
    }

    const startTime = Date.now();

    // Set up fetch timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
        const response = await fetch(IMAGEN_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': GEMINI_API_KEY,
            },
            signal: controller.signal,
            body: JSON.stringify({
                prompt: { text: prompt },
                config: {
                    numberOfImages: options.numberOfImages || 1,
                    aspectRatio: options.aspectRatio || '1:1',
                    outputMimeType: 'image/png',
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText.slice(0, 200)}`);
        }

        const data = (await response.json()) as ImagenResponse;

        if (data.error) {
            throw new Error(data.error.message);
        }

        if (!data.generatedImages || data.generatedImages.length === 0) {
            throw new Error('No images generated');
        }

        // Save the first generated image
        const imageBytes = data.generatedImages[0].image.imageBytes;
        const imageBuffer = Buffer.from(imageBytes, 'base64');

        // Create output directory if needed
        fs.mkdirSync(outputDir, { recursive: true });

        // Generate unique filename
        const timestamp = Date.now();
        const safePrompt = prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `gen_${timestamp}_${safePrompt}.png`;
        const filePath = path.join(outputDir, fileName);

        fs.writeFileSync(filePath, imageBuffer);

        logger.info(
            {
                duration: Date.now() - startTime,
                prompt: prompt.slice(0, 50),
                path: filePath,
            },
            'Image generated',
        );

        return {
            success: true,
            imagePath: filePath,
        };
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ err, prompt: prompt.slice(0, 50) }, 'Failed to generate image');

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
    return !!GEMINI_API_KEY;
}
