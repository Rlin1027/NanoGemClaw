/**
 * Speech-to-Text Module
 *
 * Transcribes voice messages (OGG/Opus) to text using Google Cloud Speech-to-Text API.
 * Falls back to Gemini multimodal if GCP credentials are not configured.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

// Configuration
const STT_PROVIDER = process.env.STT_PROVIDER || 'gemini'; // 'gcp' or 'gemini'
const GCP_CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';

/**
 * Convert OGG/Opus to linear16 WAV for GCP Speech API
 */
async function convertToWav(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.wav');

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-ar',
      '16000', // 16kHz sample rate
      '-ac',
      '1', // Mono
      '-f',
      'wav',
      '-y', // Overwrite
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-200)}`),
        );
      } else {
        resolve(outputPath);
      }
    });

    ffmpeg.on('error', reject);
  });
}

/**
 * Transcribe audio using Google Cloud Speech-to-Text V2
 */
async function transcribeWithGCP(audioPath: string): Promise<string> {
  // Dynamic import to avoid requiring the package if not used
  const { SpeechClient } = await import('@google-cloud/speech');

  const client = new SpeechClient();

  // Convert to WAV if needed
  let wavPath = audioPath;
  if (!audioPath.endsWith('.wav')) {
    wavPath = await convertToWav(audioPath);
  }

  try {
    // Check file size before reading into memory
    const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB limit
    const fileStats = fs.statSync(wavPath);
    if (fileStats.size > MAX_AUDIO_SIZE) {
      throw new Error(
        `Audio file too large (${Math.round(fileStats.size / 1024 / 1024)}MB). Maximum supported size is ${MAX_AUDIO_SIZE / 1024 / 1024}MB.`,
      );
    }

    const audioBytes = fs.readFileSync(wavPath).toString('base64');

    const [response] = await client.recognize({
      config: {
        encoding: 'LINEAR16' as const,
        sampleRateHertz: 16000,
        languageCode: 'zh-TW',
        alternativeLanguageCodes: ['en-US', 'ja-JP'],
      },
      audio: {
        content: audioBytes,
      },
    });

    const transcription = response.results
      ?.map((result) => result.alternatives?.[0]?.transcript)
      .filter(Boolean)
      .join(' ');

    return transcription || '';
  } finally {
    // Always clean up temp WAV file
    if (wavPath !== audioPath && fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }
  }
}

/**
 * Transcribe audio using Gemini multimodal API.
 *
 * Sends the audio file directly to Gemini as inline base64 data.
 * Supports OGG/Opus (Telegram voice), WAV, MP3, AAC, FLAC — no ffmpeg needed.
 */
async function transcribeWithGemini(audioPath: string): Promise<string> {
  const { getGeminiClient } = await import('@nanogemclaw/gemini');
  const client = getGeminiClient();
  if (!client) {
    throw new Error('Gemini API client not available');
  }

  const ext = path.extname(audioPath).toLowerCase();
  const MIME_MAP: Record<string, string> = {
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mp3',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.opus': 'audio/ogg',
  };
  const mimeType = MIME_MAP[ext] || 'audio/ogg';

  // Check file size (Gemini inline limit: ~20MB)
  const MAX_SIZE = 20 * 1024 * 1024;
  const stats = fs.statSync(audioPath);
  if (stats.size > MAX_SIZE) {
    throw new Error(
      `Audio file too large (${Math.round(stats.size / 1024 / 1024)}MB). Max 20MB.`,
    );
  }

  const audioData = fs.readFileSync(audioPath).toString('base64');

  const { GEMINI_MODEL } = await import('./config.js');

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType,
              data: audioData,
            },
          },
          {
            text: 'Transcribe this audio message. Return ONLY the transcribed text, nothing else. If the audio is in Chinese, transcribe in Chinese. If in English, transcribe in English. Preserve the original language.',
          },
        ],
      },
    ],
  });

  const transcription = response.text?.trim() || '';
  logger.info(
    { audioPath, length: transcription.length, provider: 'gemini' },
    'Gemini audio transcription completed',
  );
  return transcription;
}

/**
 * Main transcription function
 */
export async function transcribeAudio(audioPath: string): Promise<string> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const startTime = Date.now();

  try {
    let transcription: string;

    if (STT_PROVIDER === 'gcp' && GCP_CREDENTIALS_PATH) {
      transcription = await transcribeWithGCP(audioPath);
      logger.info(
        {
          duration: Date.now() - startTime,
          provider: 'gcp',
          length: transcription.length,
        },
        'Audio transcribed',
      );
    } else {
      // Default: Gemini multimodal audio transcription (no ffmpeg needed)
      transcription = await transcribeWithGemini(audioPath);
      logger.info(
        {
          duration: Date.now() - startTime,
          provider: 'gemini',
          length: transcription.length,
        },
        'Audio transcribed',
      );
    }

    return transcription;
  } catch (err) {
    logger.error({ err, audioPath }, 'Failed to transcribe audio');
    return '[Voice message - transcription failed]';
  }
}

/**
 * Check if ffmpeg is available on the system
 */
export async function checkFFmpegAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn('ffmpeg', ['-version']);
    check.on('error', () => resolve(false));
    check.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Check if STT is available
 */
export function isSTTAvailable(): boolean {
  return (
    STT_PROVIDER === 'gemini' ||
    (STT_PROVIDER === 'gcp' && !!GCP_CREDENTIALS_PATH)
  );
}
