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
 * Transcribe audio using Gemini multimodal (fallback)
 *
 * This is a stub that returns a placeholder.
 * In production, the audio file would be sent to the Gemini API
 * as part of the multimodal prompt.
 */
async function transcribeWithGemini(audioPath: string): Promise<string> {
  logger.info(
    { audioPath },
    'Gemini multimodal transcription (pass-through mode)',
  );

  // In pass-through mode, we don't transcribe here.
  // Instead, the audio file path is passed to the container,
  // and Gemini handles it natively with multimodal input.
  return `[Voice message: ${path.basename(audioPath)}]`;
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
      // Default: pass-through to Gemini multimodal
      transcription = await transcribeWithGemini(audioPath);
      logger.info(
        { duration: Date.now() - startTime, provider: 'gemini' },
        'Audio transcription (pass-through)',
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
