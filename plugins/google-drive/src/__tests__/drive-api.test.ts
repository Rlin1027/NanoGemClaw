/**
 * Tests for google-drive/drive-api.ts
 *
 * ~22 tests covering ALLOWED_ORDER_BY whitelist, searchFiles, listRecentFiles,
 * getFileMetadata, getFileContent, listFolderContents, mapFile, and
 * unauthenticated error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before any imports; only vi.fn() allowed.
// ---------------------------------------------------------------------------

const mockGetOAuth2Client = vi.hoisted(() => vi.fn());
const mockIsAuthenticated = vi.hoisted(() => vi.fn().mockReturnValue(true));

const mockDriveClient = vi.hoisted(() => ({
    files: {
        list: vi.fn().mockResolvedValue({ data: { files: [] } }),
        get: vi.fn().mockResolvedValue({
            data: {
                id: 'file-id',
                name: 'Test File',
                mimeType: 'text/plain',
                modifiedTime: '2026-01-01T00:00:00.000Z',
                size: '1024',
                webViewLink: 'https://drive.google.com/file/d/file-id/view',
            },
        }),
        export: vi.fn().mockResolvedValue({ data: 'exported content' }),
    },
}));

vi.mock('googleapis', () => ({
    google: {
        drive: vi.fn(() => mockDriveClient),
    },
}));

vi.mock('nanogemclaw-plugin-google-auth', () => ({
    getOAuth2Client: mockGetOAuth2Client,
    isAuthenticated: mockIsAuthenticated,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
    searchFiles,
    listRecentFiles,
    getFileMetadata,
    getFileContent,
    listFolderContents,
} from '../drive-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAuth(authenticated = true) {
    mockIsAuthenticated.mockReturnValue(authenticated);
    if (authenticated) {
        mockGetOAuth2Client.mockReturnValue({ credentials: { access_token: 'test-token' } });
    } else {
        mockGetOAuth2Client.mockReturnValue(null);
    }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('google-drive/drive-api', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupAuth(true);
        mockDriveClient.files.list.mockResolvedValue({ data: { files: [] } });
        mockDriveClient.files.get.mockResolvedValue({
            data: {
                id: 'file-id',
                name: 'Test File',
                mimeType: 'text/plain',
                modifiedTime: '2026-01-01T00:00:00.000Z',
                size: '1024',
                webViewLink: 'https://drive.google.com/file/d/file-id/view',
            },
        });
        mockDriveClient.files.export.mockResolvedValue({ data: 'exported content' });
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    // -----------------------------------------------------------------------
    // Not authenticated
    // -----------------------------------------------------------------------

    describe('when not authenticated', () => {
        beforeEach(() => {
            setupAuth(false);
        });

        it('searchFiles throws a descriptive error', async () => {
            await expect(searchFiles('test query')).rejects.toThrow('Google Drive: not authenticated');
        });

        it('listRecentFiles throws a descriptive error', async () => {
            await expect(listRecentFiles()).rejects.toThrow('Google Drive: not authenticated');
        });

        it('getFileMetadata throws a descriptive error', async () => {
            await expect(getFileMetadata('file-id')).rejects.toThrow('Google Drive: not authenticated');
        });

        it('getFileContent throws a descriptive error', async () => {
            await expect(getFileContent('file-id', 'text/plain')).rejects.toThrow(
                'Google Drive: not authenticated',
            );
        });

        it('listFolderContents throws a descriptive error', async () => {
            await expect(listFolderContents('folder-id')).rejects.toThrow(
                'Google Drive: not authenticated',
            );
        });
    });

    // -----------------------------------------------------------------------
    // mapFile (exercised through getFileMetadata)
    // -----------------------------------------------------------------------

    describe('mapFile (via getFileMetadata)', () => {
        it('returns empty string for null id', async () => {
            mockDriveClient.files.get.mockResolvedValueOnce({
                data: { id: null, name: 'File', mimeType: 'text/plain' },
            });
            const result = await getFileMetadata('file-id');
            expect(result.id).toBe('');
        });

        it('returns "(untitled)" for null name', async () => {
            mockDriveClient.files.get.mockResolvedValueOnce({
                data: { id: 'file-id', name: null, mimeType: 'text/plain' },
            });
            const result = await getFileMetadata('file-id');
            expect(result.name).toBe('(untitled)');
        });

        it('returns null for null modifiedTime', async () => {
            mockDriveClient.files.get.mockResolvedValueOnce({
                data: { id: 'file-id', name: 'File', mimeType: 'text/plain', modifiedTime: null },
            });
            const result = await getFileMetadata('file-id');
            expect(result.modifiedTime).toBeNull();
        });

        it('returns null for null webViewLink', async () => {
            mockDriveClient.files.get.mockResolvedValueOnce({
                data: { id: 'file-id', name: 'File', mimeType: 'text/plain', webViewLink: null },
            });
            const result = await getFileMetadata('file-id');
            expect(result.webViewLink).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // searchFiles
    // -----------------------------------------------------------------------

    describe('searchFiles', () => {
        it('sanitizes single quotes from query to prevent injection', async () => {
            await searchFiles("it's a test");
            const call = mockDriveClient.files.list.mock.calls[0][0] as { q: string };
            expect(call.q).not.toContain("'s");
            expect(call.q).toContain('its a test');
        });

        it('builds correct fullText contains query', async () => {
            await searchFiles('hello world');
            const call = mockDriveClient.files.list.mock.calls[0][0] as { q: string };
            expect(call.q).toContain("fullText contains 'hello world'");
        });

        it('appends trashed=false filter', async () => {
            await searchFiles('test');
            const call = mockDriveClient.files.list.mock.calls[0][0] as { q: string };
            expect(call.q).toContain('trashed = false');
        });

        it('appends folderId parent filter when provided and valid', async () => {
            await searchFiles('test', { folderId: 'folder123' });
            const call = mockDriveClient.files.list.mock.calls[0][0] as { q: string };
            expect(call.q).toContain("'folder123' in parents");
        });

        it('throws on invalid folderId format (path traversal)', async () => {
            await expect(searchFiles('test', { folderId: '../../etc/passwd' })).rejects.toThrow(
                'Invalid folderId format',
            );
        });

        it('throws on folderId with spaces', async () => {
            await expect(searchFiles('test', { folderId: 'folder id' })).rejects.toThrow(
                'Invalid folderId format',
            );
        });

        it('caps pageSize at 1000', async () => {
            await searchFiles('test', { maxResults: 9999 });
            const call = mockDriveClient.files.list.mock.calls[0][0] as { pageSize: number };
            expect(call.pageSize).toBe(1000);
        });

        it('uses the provided maxResults when below 1000', async () => {
            await searchFiles('test', { maxResults: 25 });
            const call = mockDriveClient.files.list.mock.calls[0][0] as { pageSize: number };
            expect(call.pageSize).toBe(25);
        });

        it('returns mapped DriveFile[] with totalResults count', async () => {
            mockDriveClient.files.list.mockResolvedValueOnce({
                data: {
                    files: [
                        { id: 'f1', name: 'Doc.txt', mimeType: 'text/plain', modifiedTime: '2026-01-01T00:00:00Z', size: '100', webViewLink: 'https://drive.google.com/f1' },
                    ],
                },
            });
            const result = await searchFiles('test');
            expect(result.files).toHaveLength(1);
            expect(result.totalResults).toBe(1);
            expect(result.files[0].id).toBe('f1');
        });

        it('returns empty result when no files match', async () => {
            const result = await searchFiles('notfound');
            expect(result.files).toEqual([]);
            expect(result.totalResults).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // listRecentFiles
    // -----------------------------------------------------------------------

    describe('listRecentFiles', () => {
        it('orders by modifiedTime desc', async () => {
            await listRecentFiles();
            const call = mockDriveClient.files.list.mock.calls[0][0] as { orderBy: string };
            expect(call.orderBy).toBe('modifiedTime desc');
        });

        it('excludes trashed files', async () => {
            await listRecentFiles();
            const call = mockDriveClient.files.list.mock.calls[0][0] as { q: string };
            expect(call.q).toContain('trashed = false');
        });

        it('caps maxResults at 1000', async () => {
            await listRecentFiles(9999);
            const call = mockDriveClient.files.list.mock.calls[0][0] as { pageSize: number };
            expect(call.pageSize).toBe(1000);
        });

        it('uses provided maxResults when within limit', async () => {
            await listRecentFiles(5);
            const call = mockDriveClient.files.list.mock.calls[0][0] as { pageSize: number };
            expect(call.pageSize).toBe(5);
        });

        it('returns mapped DriveFile[]', async () => {
            mockDriveClient.files.list.mockResolvedValueOnce({
                data: {
                    files: [
                        { id: 'f1', name: 'Recent.txt', mimeType: 'text/plain' },
                    ],
                },
            });
            const result = await listRecentFiles();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Recent.txt');
        });
    });

    // -----------------------------------------------------------------------
    // getFileMetadata
    // -----------------------------------------------------------------------

    describe('getFileMetadata', () => {
        it('passes the correct fields parameter', async () => {
            await getFileMetadata('my-file-id');
            expect(mockDriveClient.files.get).toHaveBeenCalledWith(
                expect.objectContaining({
                    fileId: 'my-file-id',
                    fields: 'id,name,mimeType,modifiedTime,size,webViewLink',
                }),
            );
        });

        it('returns a DriveFile with correct fields', async () => {
            const result = await getFileMetadata('file-id');
            expect(result).toMatchObject({
                id: 'file-id',
                name: 'Test File',
                mimeType: 'text/plain',
            });
        });
    });

    // -----------------------------------------------------------------------
    // getFileContent
    // -----------------------------------------------------------------------

    describe('getFileContent', () => {
        it('exports Google Docs as text/plain', async () => {
            mockDriveClient.files.export.mockResolvedValueOnce({ data: 'document text' });
            const result = await getFileContent('file-id', 'application/vnd.google-apps.document');
            expect(mockDriveClient.files.export).toHaveBeenCalledWith(
                expect.objectContaining({ mimeType: 'text/plain' }),
                expect.anything(),
            );
            expect(result).toBe('document text');
        });

        it('exports Google Sheets as text/csv', async () => {
            mockDriveClient.files.export.mockResolvedValueOnce({ data: 'col1,col2\nval1,val2' });
            const result = await getFileContent('file-id', 'application/vnd.google-apps.spreadsheet');
            expect(mockDriveClient.files.export).toHaveBeenCalledWith(
                expect.objectContaining({ mimeType: 'text/csv' }),
                expect.anything(),
            );
            expect(result).toBe('col1,col2\nval1,val2');
        });

        it('exports Google Slides as text/plain', async () => {
            mockDriveClient.files.export.mockResolvedValueOnce({ data: 'slide text' });
            await getFileContent('file-id', 'application/vnd.google-apps.presentation');
            expect(mockDriveClient.files.export).toHaveBeenCalledWith(
                expect.objectContaining({ mimeType: 'text/plain' }),
                expect.anything(),
            );
        });

        it('uses direct download (alt=media) for non-Workspace types', async () => {
            mockDriveClient.files.get.mockResolvedValueOnce({ data: 'plain text content' });
            const result = await getFileContent('file-id', 'text/plain');
            expect(mockDriveClient.files.get).toHaveBeenCalledWith(
                expect.objectContaining({ alt: 'media' }),
                expect.anything(),
            );
            expect(result).toBe('plain text content');
        });

        it('uses direct download for PDF type', async () => {
            mockDriveClient.files.get.mockResolvedValueOnce({ data: '%PDF-1.4 ...' });
            await getFileContent('file-id', 'application/pdf');
            expect(mockDriveClient.files.get).toHaveBeenCalledWith(
                expect.objectContaining({ alt: 'media' }),
                expect.anything(),
            );
        });

        it('JSON-stringifies non-string responses from export', async () => {
            mockDriveClient.files.export.mockResolvedValueOnce({ data: { some: 'object' } });
            const result = await getFileContent('file-id', 'application/vnd.google-apps.document');
            expect(result).toBe(JSON.stringify({ some: 'object' }));
        });
    });

    // -----------------------------------------------------------------------
    // listFolderContents
    // -----------------------------------------------------------------------

    describe('listFolderContents', () => {
        it('throws on invalid folderId format (path traversal)', async () => {
            await expect(listFolderContents('../evil')).rejects.toThrow('Invalid folderId format');
        });

        it('throws on folderId with special characters', async () => {
            await expect(listFolderContents('folder<script>')).rejects.toThrow('Invalid folderId format');
        });

        it('accepts valid folderId (alphanumeric, hyphens, underscores)', async () => {
            await expect(listFolderContents('folder-123_abc')).resolves.not.toThrow();
        });

        it('defaults orderBy to "name" when not provided', async () => {
            await listFolderContents('folder-1');
            const call = mockDriveClient.files.list.mock.calls[0][0] as { orderBy: string };
            expect(call.orderBy).toBe('name');
        });

        it('uses valid orderBy value from whitelist', async () => {
            await listFolderContents('folder-1', { orderBy: 'modifiedTime desc' });
            const call = mockDriveClient.files.list.mock.calls[0][0] as { orderBy: string };
            expect(call.orderBy).toBe('modifiedTime desc');
        });

        it('falls back to "name" for invalid orderBy value', async () => {
            await listFolderContents('folder-1', { orderBy: 'badOrderBy; DROP TABLE' });
            const call = mockDriveClient.files.list.mock.calls[0][0] as { orderBy: string };
            expect(call.orderBy).toBe('name');
        });

        it('builds correct parent query including trashed=false', async () => {
            await listFolderContents('my-folder');
            const call = mockDriveClient.files.list.mock.calls[0][0] as { q: string };
            expect(call.q).toContain("'my-folder' in parents");
            expect(call.q).toContain('trashed = false');
        });

        it('caps maxResults at 1000', async () => {
            await listFolderContents('folder-1', { maxResults: 5000 });
            const call = mockDriveClient.files.list.mock.calls[0][0] as { pageSize: number };
            expect(call.pageSize).toBe(1000);
        });
    });
});
