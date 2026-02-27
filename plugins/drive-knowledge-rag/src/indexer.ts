/**
 * Document indexer for the Drive Knowledge RAG plugin.
 *
 * Scans a set of Drive folders, detects new/changed files, extracts text,
 * splits into ~1000-char chunks, generates embeddings, and persists the
 * resulting index to `{dataDir}/knowledge-index.json`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { listFolderContents, extractContent } from 'nanogemclaw-plugin-google-drive';
import type { DriveFile } from 'nanogemclaw-plugin-google-drive';
import type { PluginApi } from '@nanogemclaw/plugin-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexedChunk {
    text: string;
    embedding: number[];
    startOffset: number;
}

export interface IndexedDocument {
    fileId: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    chunks: IndexedChunk[];
}

export interface KnowledgeIndex {
    /** keyed by fileId */
    documents: Record<string, IndexedDocument>;
    /** ISO timestamp of last full scan */
    lastScanAt: string | null;
}

export function emptyIndex(): KnowledgeIndex {
    return { documents: {}, lastScanAt: null };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function loadIndex(dataDir: string): Promise<KnowledgeIndex> {
    const indexPath = path.join(dataDir, 'knowledge-index.json');
    try {
        const raw = await fs.readFile(indexPath, 'utf-8');
        return JSON.parse(raw) as KnowledgeIndex;
    } catch {
        return emptyIndex();
    }
}

export async function saveIndex(dataDir: string, index: KnowledgeIndex): Promise<void> {
    const indexPath = path.join(dataDir, 'knowledge-index.json');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split text into paragraphs first, then combine adjacent paragraphs until
 * the combined length approaches `maxChars`.  This keeps chunks semantically
 * cohesive while respecting the size limit.
 */
function chunkText(text: string, maxChars = 1000): Array<{ text: string; startOffset: number }> {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const chunks: Array<{ text: string; startOffset: number }> = [];

    let current = '';
    let startOffset = 0;
    let cursor = 0;

    for (const para of paragraphs) {
        const candidate = current ? `${current}\n\n${para}` : para;
        if (candidate.length > maxChars && current.length > 0) {
            chunks.push({ text: current, startOffset });
            startOffset = cursor;
            current = para;
        } else {
            current = candidate;
        }
        // Advance cursor past this paragraph and the separator
        cursor += para.length + 2;
    }

    if (current.length > 0) {
        chunks.push({ text: current, startOffset });
    }

    // If nothing split (no blank lines), hard-split on maxChars
    if (chunks.length === 0 && text.length > 0) {
        for (let i = 0; i < text.length; i += maxChars) {
            chunks.push({ text: text.slice(i, i + maxChars), startOffset: i });
        }
    }

    return chunks;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

async function embedBatch(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set — cannot generate embeddings');
    }

    const genai = new GoogleGenAI({ apiKey });
    const embeddings: number[][] = [];

    // Embed sequentially to avoid rate-limiting
    for (const text of texts) {
        const response = await genai.models.embedContent({
            model: 'text-embedding-004',
            contents: [{ parts: [{ text }] }],
        });
        const values = response.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
            throw new Error(`Empty embedding returned for text starting with: "${text.slice(0, 60)}"`);
        }
        embeddings.push(values);
    }

    return embeddings;
}

// ---------------------------------------------------------------------------
// Index a single file
// ---------------------------------------------------------------------------

export async function indexFile(
    file: DriveFile,
    maxChunkChars: number,
    logger: PluginApi['logger'],
): Promise<IndexedDocument | null> {
    let extracted: { content: string; mimeType: string; truncated: boolean };
    try {
        extracted = await extractContent(file.id, file.mimeType);
    } catch (err) {
        logger.warn(`drive-knowledge-rag: cannot extract "${file.name}" — ${err}`);
        return null;
    }

    if (!extracted.content || extracted.content.trim().length === 0) {
        logger.debug(`drive-knowledge-rag: skipping empty file "${file.name}"`);
        return null;
    }

    const rawChunks = chunkText(extracted.content, maxChunkChars);
    if (rawChunks.length === 0) return null;

    let embeddings: number[][];
    try {
        embeddings = await embedBatch(rawChunks.map((c) => c.text));
    } catch (err) {
        logger.warn(`drive-knowledge-rag: embedding failed for "${file.name}" — ${err}`);
        return null;
    }

    const chunks: IndexedChunk[] = rawChunks.map((c, i) => ({
        text: c.text,
        embedding: embeddings[i],
        startOffset: c.startOffset,
    }));

    return {
        fileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        chunks,
    };
}

// ---------------------------------------------------------------------------
// Remove stale documents
// ---------------------------------------------------------------------------

export function removeStaleDocuments(
    index: KnowledgeIndex,
    currentFileIds: Set<string>,
): { removed: number } {
    let removed = 0;
    for (const fileId of Object.keys(index.documents)) {
        if (!currentFileIds.has(fileId)) {
            delete index.documents[fileId];
            removed++;
        }
    }
    return { removed };
}

// ---------------------------------------------------------------------------
// Full folder scan
// ---------------------------------------------------------------------------

export async function scanAndIndex(
    folderIds: string[],
    index: KnowledgeIndex,
    maxChunkChars: number,
    api: PluginApi,
): Promise<{ added: number; updated: number; removed: number; skipped: number }> {
    const logger = api.logger;
    const stats = { added: 0, updated: 0, removed: 0, skipped: 0 };

    if (folderIds.length === 0) {
        logger.debug('drive-knowledge-rag: no folders configured — skipping scan');
        return stats;
    }

    // Collect all files across all configured folders
    const allFiles = new Map<string, DriveFile>();

    for (const folderId of folderIds) {
        let files: DriveFile[];
        try {
            files = await listFolderContents(folderId, { recursive: true });
        } catch (err) {
            logger.warn(`drive-knowledge-rag: cannot list folder ${folderId} — ${err}`);
            continue;
        }
        for (const file of files) {
            allFiles.set(file.id, file);
        }
    }

    // Remove documents whose source files are gone
    const currentIds = new Set(allFiles.keys());
    const { removed } = removeStaleDocuments(index, currentIds);
    stats.removed = removed;

    // Index new or changed files
    for (const file of allFiles.values()) {
        const existing = index.documents[file.id];

        if (existing && existing.modifiedTime === file.modifiedTime) {
            stats.skipped++;
            continue;
        }

        logger.info(
            `drive-knowledge-rag: indexing "${file.name}" (${existing ? 'updated' : 'new'})`,
        );

        const doc = await indexFile(file, maxChunkChars, logger);
        if (doc) {
            const isNew = !existing;
            index.documents[file.id] = doc;
            if (isNew) {
                stats.added++;
            } else {
                stats.updated++;
            }
        } else {
            stats.skipped++;
        }
    }

    index.lastScanAt = new Date().toISOString();
    await saveIndex(api.dataDir, index);

    logger.info(
        `drive-knowledge-rag: scan complete — ` +
        `added=${stats.added} updated=${stats.updated} removed=${stats.removed} skipped=${stats.skipped}`,
    );

    return stats;
}
