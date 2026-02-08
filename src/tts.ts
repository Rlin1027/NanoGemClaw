/**
 * Text-to-Speech (TTS) Service (Stub)
 *
 * Future implementation will:
 * - Convert text responses to audio (MP3/OGG)
 * - Use Google TTS, OpenAI TTS, or ElevenLabs
 * - Send audio via Telegram voice messages
 */

import { logger } from './logger.js';

export class TTSService {
  private static instance: TTSService;

  private constructor() {}

  public static getInstance(): TTSService {
    if (!TTSService.instance) {
      TTSService.instance = new TTSService();
    }
    return TTSService.instance;
  }

  public async textToSpeech(
    text: string,
    lang: string = 'zh-TW',
  ): Promise<Buffer | null> {
    logger.info(
      { length: text.length, lang },
      'TTS generation not implemented yet',
    );
    return null;
  }
}

export const ttsService = TTSService.getInstance();
