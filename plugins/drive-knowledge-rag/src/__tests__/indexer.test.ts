/**
 * Tests for drive-knowledge-rag/indexer.ts
 *
 * ~25 tests covering emptyIndex, loadIndex, saveIndex, scanAndIndex,
 * chunkText (via indexFile), embedding failure handling, stale document
 * removal, and file deletion tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before any imports; only vi.fn() allowed.
// ---------------------------------------------------------------------------

const mockFsReadFile = vi.hoisted(() => vi.fn());
const mockFsWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFsMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFsRename = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('node:fs/promises', () => ({
    default: {
        readFile: mockFsReadFile,
        writeFile: mockFsWriteFile,
        mkdir: mockFsMkdir,
        rename: mockFsRename,
    },
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
    mkdir: mockFsMkdir,
    rename: mockFsRename,
}));

const mockEmbedContent = vi.hoisted(() => vi.fn());
const MockGoogleGenAI = vi.hoisted(() =>
    vi.fn().mockImplementation(function () {
        return { models: { embedContent: mockEmbedContent } };
    }),
);

vi.mock('@google/genai', () => ({
    GoogleGenAI: MockGoogleGenAI,
}));

const mockListFolderContents = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockExtractContent = vi.hoisted(() =>
    vi.fn().mockResolvedValue({ content: 'Hello world', mimeType: 'text/plain', truncated: false }),
);

vi.mock('nanogemclaw-plugin-google-drive', () => ({
    listFolderContents: mockListFolderContents,
    extractContent: mockExtractContent,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
    emptyIndex,
    loadIndex,
    saveIndex,
    scanAndIndex,
    indexFile,
    removeStaleDocuments,
} from '../indexer.js';
import type { KnowledgeIndex, IndexedDocument } from '../indexer.js';
import type { DriveFile } from 'nanogemclaw-plugin-google-drive';
import { createMockPluginApi } from '../../../__tests__/helpers/plugin-api-mock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_DIR = '/tmp/test-rag-data';
const DEFAULT_EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5];

function makeDriveFile(overrides: Partial<DriveFile> = {}): DriveFile {
    return {
        id: 'file-1',
        name: 'Document.txt',
        mimeType: 'text/plain',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        size: '1024',
        webViewLink: 'https://drive.google.com/file/d/file-1/view',
        ...overrides,
    };
}

function makeIndexedDoc(overrides: Partial<IndexedDocument> = {}): IndexedDocument {
    return {
        fileId: 'file-1',
        name: 'Document.txt',
        mimeType: 'text/plain',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        chunks: [{ text: 'Hello world', embedding: [0.1, 0.2, 0.3], startOffset: 0 }],
        ...overrides,
    };
}

function makeIndex(overrides: Partial<KnowledgeIndex> = {}): KnowledgeIndex {
    return { documents: {}, lastScanAt: null, ...overrides };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('drive-knowledge-rag/indexer', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Restore GoogleGenAI mock implementation after clearAllMocks wipes it
        MockGoogleGenAI.mockImplementation(function () {
            return { models: { embedContent: mockEmbedContent } };
        });

        // Default: embedding succeeds
        mockEmbedContent.mockResolvedValue({
            embeddings: [{ values: DEFAULT_EMBEDDING }],
        });

        // Default: fs operations succeed
        mockFsReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
        mockFsWriteFile.mockResolvedValue(undefined);
        mockFsMkdir.mockResolvedValue(undefined);
        mockFsRename.mockResolvedValue(undefined);

        // Default: drive operations
        mockListFolderContents.mockResolvedValue([]);
        mockExtractContent.mockResolvedValue({
            content: 'Hello world',
            mimeType: 'text/plain',
            truncated: false,
        });

        process.env.GEMINI_API_KEY = 'test-api-key';
    });

    afterEach(() => {
        delete process.env.GEMINI_API_KEY;
        vi.resetAllMocks();
    });

    // -----------------------------------------------------------------------
    // emptyIndex
    // -----------------------------------------------------------------------

    describe('emptyIndex', () => {
        it('returns an object with empty documents record', () => {
            const index = emptyIndex();
            expect(index.documents).toEqual({});
        });

        it('returns lastScanAt as null', () => {
            const index = emptyIndex();
            expect(index.lastScanAt).toBeNull();
        });

        it('returns a fresh object each call (no shared reference)', () => {
            const a = emptyIndex();
            const b = emptyIndex();
            a.documents['test'] = makeIndexedDoc();
            expect(b.documents).toEqual({});
        });
    });

    // -----------------------------------------------------------------------
    // loadIndex
    // -----------------------------------------------------------------------

    describe('loadIndex', () => {
        it('returns emptyIndex when file does not exist', async () => {
            const result = await loadIndex(DATA_DIR);
            expect(result).toEqual({ documents: {}, lastScanAt: null });
        });

        it('parses and returns valid JSON from disk', async () => {
            const stored = makeIndex({
                lastScanAt: '2026-01-01T00:00:00.000Z',
                documents: { 'file-1': makeIndexedDoc() },
            });
            mockFsReadFile.mockResolvedValueOnce(JSON.stringify(stored));
            const result = await loadIndex(DATA_DIR);
            expect(result.lastScanAt).toBe('2026-01-01T00:00:00.000Z');
            expect(result.documents['file-1']).toBeDefined();
        });

        it('handles corrupt JSON gracefully by returning empty index', async () => {
            mockFsReadFile.mockResolvedValueOnce('{corrupt JSON{{');
            const result = await loadIndex(DATA_DIR);
            expect(result).toEqual({ documents: {}, lastScanAt: null });
        });

        it('reads from the correct path (knowledge-index.json)', async () => {
            await loadIndex('/my/data/dir');
            expect(mockFsReadFile).toHaveBeenCalledWith(
                expect.stringContaining('knowledge-index.json'),
                'utf-8',
            );
        });
    });

    // -----------------------------------------------------------------------
    // saveIndex
    // -----------------------------------------------------------------------

    describe('saveIndex', () => {
        it('creates parent directory with recursive=true', async () => {
            await saveIndex(DATA_DIR, makeIndex());
            expect(mockFsMkdir).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
        });

        it('writes to a tmp file first (atomic write pattern)', async () => {
            await saveIndex(DATA_DIR, makeIndex());
            const writtenPath = mockFsWriteFile.mock.calls[0]?.[0] as string;
            expect(writtenPath).toContain('.tmp.');
        });

        it('renames tmp file to final knowledge-index.json path', async () => {
            await saveIndex(DATA_DIR, makeIndex());
            const tmpPath = mockFsWriteFile.mock.calls[0]?.[0] as string;
            const [renameSrc, renameDest] = mockFsRename.mock.calls[0] as [string, string];
            expect(renameSrc).toBe(tmpPath);
            expect(renameDest).toContain('knowledge-index.json');
        });

        it('serializes index to JSON string', async () => {
            const index = makeIndex({ lastScanAt: '2026-01-15T00:00:00.000Z' });
            await saveIndex(DATA_DIR, index);
            const written = mockFsWriteFile.mock.calls[0]?.[1] as string;
            const parsed = JSON.parse(written);
            expect(parsed.lastScanAt).toBe('2026-01-15T00:00:00.000Z');
        });
    });

    // -----------------------------------------------------------------------
    // removeStaleDocuments
    // -----------------------------------------------------------------------

    describe('removeStaleDocuments', () => {
        it('removes documents whose fileId is not in the current set', () => {
            const index = makeIndex({
                documents: { 'file-gone': makeIndexedDoc({ fileId: 'file-gone' }) },
            });
            const { removed } = removeStaleDocuments(index, new Set(['file-present']));
            expect(removed).toBe(1);
            expect(index.documents['file-gone']).toBeUndefined();
        });

        it('retains documents whose fileId is in the current set', () => {
            const index = makeIndex({
                documents: { 'file-1': makeIndexedDoc({ fileId: 'file-1' }) },
            });
            removeStaleDocuments(index, new Set(['file-1']));
            expect(index.documents['file-1']).toBeDefined();
        });

        it('returns removed=0 when no stale documents', () => {
            const index = makeIndex({
                documents: { 'file-1': makeIndexedDoc({ fileId: 'file-1' }) },
            });
            const { removed } = removeStaleDocuments(index, new Set(['file-1']));
            expect(removed).toBe(0);
        });

        it('removes multiple stale documents and counts correctly', () => {
            const index = makeIndex({
                documents: {
                    'file-a': makeIndexedDoc({ fileId: 'file-a' }),
                    'file-b': makeIndexedDoc({ fileId: 'file-b' }),
                    'file-c': makeIndexedDoc({ fileId: 'file-c' }),
                },
            });
            const { removed } = removeStaleDocuments(index, new Set(['file-b']));
            expect(removed).toBe(2);
            expect(index.documents['file-b']).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // indexFile (also exercises chunkText via content)
    // -----------------------------------------------------------------------

    describe('indexFile', () => {
        it('returns null when extractContent fails', async () => {
            const api = createMockPluginApi();
            mockExtractContent.mockRejectedValueOnce(new Error('Drive API error'));
            const result = await indexFile(makeDriveFile(), 1000, api.logger);
            expect(result).toBeNull();
            expect(api.logger.warn).toHaveBeenCalled();
        });

        it('returns null when content is empty', async () => {
            const api = createMockPluginApi();
            mockExtractContent.mockResolvedValueOnce({
                content: '   ',
                mimeType: 'text/plain',
                truncated: false,
            });
            const result = await indexFile(makeDriveFile(), 1000, api.logger);
            expect(result).toBeNull();
        });

        it('returns an IndexedDocument with chunks on success', async () => {
            const api = createMockPluginApi();
            const result = await indexFile(makeDriveFile(), 1000, api.logger);
            expect(result).not.toBeNull();
            expect(result!.fileId).toBe('file-1');
            expect(result!.chunks.length).toBeGreaterThan(0);
        });

        it('embeds each chunk and stores embedding values', async () => {
            const api = createMockPluginApi();
            const result = await indexFile(makeDriveFile(), 1000, api.logger);
            expect(result!.chunks[0].embedding).toEqual(DEFAULT_EMBEDDING);
        });

        it('returns null when embedding fails and logs a warning', async () => {
            const api = createMockPluginApi();
            mockEmbedContent.mockRejectedValue(new Error('Embedding API error'));
            const result = await indexFile(makeDriveFile(), 1000, api.logger);
            expect(result).toBeNull();
            expect(api.logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('embedding failed'),
            );
        });
    });

    // -----------------------------------------------------------------------
    // chunkText (exercised through indexFile with controlled content)
    // -----------------------------------------------------------------------

    describe('chunkText (via indexFile)', () => {
        it('produces a single chunk when content fits within maxChunkChars', async () => {
            const api = createMockPluginApi();
            mockExtractContent.mockResolvedValueOnce({
                content: 'Short text that easily fits.',
                mimeType: 'text/plain',
                truncated: false,
            });
            const result = await indexFile(makeDriveFile(), 1000, api.logger);
            expect(result!.chunks).toHaveLength(1);
            expect(result!.chunks[0].text).toBe('Short text that easily fits.');
        });

        it('splits on double newlines (paragraphs) respecting maxChunkChars', async () => {
            const api = createMockPluginApi();
            // Two paragraphs each 400 chars, combined 802 chars > maxChunkChars=500
            const para1 = 'A'.repeat(400);
            const para2 = 'B'.repeat(400);
            mockExtractContent.mockResolvedValueOnce({
                content: `${para1}\n\n${para2}`,
                mimeType: 'text/plain',
                truncated: false,
            });
            mockEmbedContent
                .mockResolvedValueOnce({ embeddings: [{ values: [0.1] }] })
                .mockResolvedValueOnce({ embeddings: [{ values: [0.2] }] });
            const result = await indexFile(makeDriveFile(), 500, api.logger);
            expect(result!.chunks.length).toBeGreaterThanOrEqual(2);
        });

        it('produces one oversized chunk for long text with no blank lines (hard-split guard only activates on truly empty output)', async () => {
            const api = createMockPluginApi();
            // chunkText splits on \n{2,} — a single long paragraph with no blank lines
            // ends up as one chunk (the single-paragraph else-branch runs, current becomes
            // the full text, then it is pushed at the end). The hard-split path only
            // fires when chunks.length === 0 (unreachable for non-empty single-line text).
            const longText = 'X'.repeat(2500);
            mockExtractContent.mockResolvedValueOnce({
                content: longText,
                mimeType: 'text/plain',
                truncated: false,
            });
            mockEmbedContent.mockResolvedValueOnce({ embeddings: [{ values: [0.1] }] });
            const result = await indexFile(makeDriveFile(), 1000, api.logger);
            expect(result!.chunks).toHaveLength(1);
            expect(result!.chunks[0].text).toBe(longText);
        });
    });

    // -----------------------------------------------------------------------
    // scanAndIndex
    // -----------------------------------------------------------------------

    describe('scanAndIndex', () => {
        it('returns all-zero stats and skips scan when folderIds is empty', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            const index = makeIndex();
            const stats = await scanAndIndex([], index, 1000, api);
            expect(stats).toEqual({ added: 0, updated: 0, removed: 0, skipped: 0 });
            expect(mockListFolderContents).not.toHaveBeenCalled();
        });

        it('skips files with unchanged modifiedTime (incremental update)', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            const file = makeDriveFile({ modifiedTime: '2026-01-01T00:00:00.000Z' });
            mockListFolderContents.mockResolvedValueOnce([file]);
            const index = makeIndex({
                documents: {
                    'file-1': makeIndexedDoc({ modifiedTime: '2026-01-01T00:00:00.000Z' }),
                },
            });
            const stats = await scanAndIndex(['folder-1'], index, 1000, api);
            expect(stats.skipped).toBe(1);
            expect(stats.added).toBe(0);
            expect(stats.updated).toBe(0);
            expect(mockExtractContent).not.toHaveBeenCalled();
        });

        it('indexes new files and increments added count', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            const file = makeDriveFile();
            mockListFolderContents.mockResolvedValueOnce([file]);
            const index = makeIndex();
            const stats = await scanAndIndex(['folder-1'], index, 1000, api);
            expect(stats.added).toBe(1);
            expect(stats.updated).toBe(0);
        });

        it('increments updated count when modifiedTime has changed', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            const file = makeDriveFile({ modifiedTime: '2026-02-01T00:00:00.000Z' });
            mockListFolderContents.mockResolvedValueOnce([file]);
            const index = makeIndex({
                documents: {
                    'file-1': makeIndexedDoc({ modifiedTime: '2026-01-01T00:00:00.000Z' }),
                },
            });
            const stats = await scanAndIndex(['folder-1'], index, 1000, api);
            expect(stats.updated).toBe(1);
            expect(stats.added).toBe(0);
        });

        it('removes stale documents and counts them in removed stat', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            mockListFolderContents.mockResolvedValueOnce([]); // folder is now empty
            const index = makeIndex({
                documents: {
                    'file-deleted': makeIndexedDoc({ fileId: 'file-deleted' }),
                },
            });
            const stats = await scanAndIndex(['folder-1'], index, 1000, api);
            expect(stats.removed).toBe(1);
            expect(index.documents['file-deleted']).toBeUndefined();
        });

        it('continues indexing remaining files when one file fails embedding', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            const file1 = makeDriveFile({ id: 'file-1', name: 'File1.txt' });
            const file2 = makeDriveFile({ id: 'file-2', name: 'File2.txt' });
            mockListFolderContents.mockResolvedValueOnce([file1, file2]);

            mockExtractContent
                .mockResolvedValueOnce({ content: 'Content 1', mimeType: 'text/plain', truncated: false })
                .mockResolvedValueOnce({ content: 'Content 2', mimeType: 'text/plain', truncated: false });

            // file-1 embedding fails (all retries), file-2 succeeds
            mockEmbedContent
                .mockRejectedValueOnce(new Error('Quota exceeded'))
                .mockRejectedValueOnce(new Error('Quota exceeded'))
                .mockRejectedValueOnce(new Error('Quota exceeded'))
                .mockResolvedValueOnce({ embeddings: [{ values: [0.1, 0.2] }] });

            const index = makeIndex();
            const stats = await scanAndIndex(['folder-1'], index, 1000, api);

            // file-1 failed embedding → skipped, file-2 → added
            expect(stats.added).toBe(1);
            expect(stats.skipped).toBe(1);
        });

        it('handles listFolderContents failure gracefully and warns', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            mockListFolderContents
                .mockRejectedValueOnce(new Error('Drive API error'))
                .mockResolvedValueOnce([makeDriveFile({ id: 'file-ok' })]);

            const index = makeIndex();
            await expect(scanAndIndex(['bad-folder', 'good-folder'], index, 1000, api)).resolves.not.toThrow();
            expect(api.logger.warn).toHaveBeenCalled();
        });

        it('sets lastScanAt timestamp on the index after scan', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            mockListFolderContents.mockResolvedValueOnce([]);
            const index = makeIndex();
            await scanAndIndex(['folder-1'], index, 1000, api);
            expect(index.lastScanAt).not.toBeNull();
            expect(() => new Date(index.lastScanAt!)).not.toThrow();
        });

        it('saves the index to disk after scanning', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            mockListFolderContents.mockResolvedValueOnce([]);
            const index = makeIndex();
            await scanAndIndex(['folder-1'], index, 1000, api);
            expect(mockFsWriteFile).toHaveBeenCalled();
            expect(mockFsRename).toHaveBeenCalled();
        });

        it('combines files from multiple folders', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            const file1 = makeDriveFile({ id: 'file-a', name: 'FileA.txt' });
            const file2 = makeDriveFile({ id: 'file-b', name: 'FileB.txt' });
            mockListFolderContents
                .mockResolvedValueOnce([file1])
                .mockResolvedValueOnce([file2]);

            mockEmbedContent
                .mockResolvedValueOnce({ embeddings: [{ values: [0.1] }] })
                .mockResolvedValueOnce({ embeddings: [{ values: [0.2] }] });

            const index = makeIndex();
            const stats = await scanAndIndex(['folder-1', 'folder-2'], index, 1000, api);
            expect(stats.added).toBe(2);
        });
    });
});
