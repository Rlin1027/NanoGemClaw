/**
 * Media Handler - Media download, extraction, and cleanup.
 */
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';

import { CLEANUP, GROUPS_DIR, TELEGRAM_BOT_TOKEN, MAX_DOWNLOAD_BYTES } from './config.js';
import { logger } from './logger.js';
import { getBot } from './state.js';
import { formatError } from './utils.js';

// ============================================================================
// Media Info Interface
// ============================================================================

export interface MediaInfo {
    type: 'photo' | 'voice' | 'audio' | 'video' | 'document';
    fileId: string;
    fileName?: string;
    mimeType?: string;
    caption?: string;
}

// ============================================================================
// Media Extraction
// ============================================================================

export function extractMediaInfo(msg: TelegramBot.Message): MediaInfo | null {
    if (msg.photo && msg.photo.length > 0) {
        // Get highest resolution photo
        const photo = msg.photo[msg.photo.length - 1];
        return {
            type: 'photo',
            fileId: photo.file_id,
            caption: msg.caption,
        };
    }
    if (msg.voice) {
        return {
            type: 'voice',
            fileId: msg.voice.file_id,
            mimeType: msg.voice.mime_type,
        };
    }
    if (msg.audio) {
        return {
            type: 'audio',
            fileId: msg.audio.file_id,
            mimeType: msg.audio.mime_type,
        };
    }
    if (msg.video) {
        return {
            type: 'video',
            fileId: msg.video.file_id,
            mimeType: msg.video.mime_type,
            caption: msg.caption,
        };
    }
    if (msg.document) {
        return {
            type: 'document',
            fileId: msg.document.file_id,
            fileName: msg.document.file_name,
            mimeType: msg.document.mime_type,
            caption: msg.caption,
        };
    }
    return null;
}

// ============================================================================
// Media Download
// ============================================================================

export async function downloadMedia(
    fileId: string,
    groupFolder: string,
    fileName?: string,
): Promise<string | null> {
    const bot = getBot();
    try {
        const fileInfo = await bot.getFile(fileId);
        if (!fileInfo.file_path) return null;

        const mediaDir = path.join(GROUPS_DIR, groupFolder, 'media');
        fs.mkdirSync(mediaDir, { recursive: true });

        const ext = path.extname(fileInfo.file_path) || '.bin';
        const sanitizedName = path
            .basename(fileName || '')
            .replace(/[^a-zA-Z0-9._-]/g, '_');
        const finalName = sanitizedName || `${Date.now()}${ext}`;
        const localPath = path.join(mediaDir, finalName);
        // Security: verify path is within mediaDir
        if (!path.resolve(localPath).startsWith(path.resolve(mediaDir))) {
            throw new Error('Invalid file path detected');
        }

        // Download file
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

        await new Promise<void>((resolve, reject) => {
            const file = fs.createWriteStream(localPath);
            https
                .get(fileUrl, (response) => {
                    // Check for successful HTTP response
                    if (response.statusCode !== 200) {
                        fs.unlink(localPath, () => {});
                        reject(
                            new Error(
                                `HTTP ${response.statusCode}: Failed to download media`,
                            ),
                        );
                        return;
                    }

                    // Content-Length pre-check: reject if > MAX_DOWNLOAD_BYTES
                    const contentLength = parseInt(response.headers['content-length'] || '0', 10);
                    if (contentLength > 0 && contentLength > MAX_DOWNLOAD_BYTES) {
                        response.destroy();
                        fs.unlink(localPath, () => {});
                        reject(new Error(`File too large: ${contentLength} bytes exceeds limit of ${MAX_DOWNLOAD_BYTES} bytes`));
                        return;
                    }

                    // Streaming byte counter: track received bytes, destroy if exceeded
                    let receivedBytes = 0;
                    response.on('data', (chunk: Buffer) => {
                        receivedBytes += chunk.length;
                        if (receivedBytes > MAX_DOWNLOAD_BYTES) {
                            response.destroy();
                            file.destroy();
                            fs.unlink(localPath, () => {});
                            reject(new Error(`Download size limit exceeded: received ${receivedBytes} bytes`));
                        }
                    });

                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                })
                .on('error', (err) => {
                    fs.unlink(localPath, () => {});
                    reject(err);
                });
        });

        logger.debug({ localPath }, 'Media downloaded');
        return localPath;
    } catch (err) {
        logger.error({ err, fileId }, 'Failed to download media');
        return null;
    }
}

// ============================================================================
// Media Cleanup
// ============================================================================

function cleanupOldMedia(): void {
    const now = Date.now();
    const maxAge = CLEANUP.MEDIA_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    try {
        // Iterate through all group folders
        const groupFolders = fs.readdirSync(GROUPS_DIR);
        for (const folder of groupFolders) {
            const mediaDir = path.join(GROUPS_DIR, folder, 'media');
            if (!fs.existsSync(mediaDir)) continue;

            const files = fs.readdirSync(mediaDir);
            for (const file of files) {
                const filePath = path.join(mediaDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxAge) {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                    }
                } catch {
                    // Ignore individual file errors
                }
            }
        }

        if (deletedCount > 0) {
            logger.info({ deletedCount }, 'Old media files cleaned up');
        }
    } catch (err) {
        logger.error({ err: formatError(err) }, 'Error during media cleanup');
    }
}

export function startMediaCleanupScheduler(): void {
    // Run immediately on startup
    cleanupOldMedia();
    // Then run periodically
    setInterval(cleanupOldMedia, CLEANUP.MEDIA_CLEANUP_INTERVAL_MS);
    logger.info(
        { intervalHours: CLEANUP.MEDIA_CLEANUP_INTERVAL_HOURS },
        'Media cleanup scheduler started',
    );
}
