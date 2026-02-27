/**
 * Tests for google-drive/content-extractor.ts
 * ~14 tests covering truncateContent and extractContent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock drive-api before importing the module under test
// ---------------------------------------------------------------------------

const mockGetFileContent = vi.hoisted(() => vi.fn());

vi.mock('../drive-api.js', () => ({
  getFileContent: mockGetFileContent,
}));

import { truncateContent, extractContent } from '../content-extractor.js';

// ============================================================================
// truncateContent
// ============================================================================

describe('truncateContent', () => {
  it('returns the original content unchanged when length < maxChars', () => {
    const result = truncateContent('hello', 10);
    expect(result.content).toBe('hello');
    expect(result.truncated).toBe(false);
  });

  it('returns the original content unchanged when length === maxChars (exact boundary)', () => {
    const content = 'a'.repeat(100);
    const result = truncateContent(content, 100);
    expect(result.content).toBe(content);
    expect(result.truncated).toBe(false);
  });

  it('truncates and appends marker when length > maxChars', () => {
    const content = 'a'.repeat(101);
    const result = truncateContent(content, 100);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('... [truncated]');
    expect(result.content).toHaveLength(100 + '... [truncated]'.length);
  });

  it('slices at exactly maxChars before appending the marker', () => {
    const content = 'abcde';
    const result = truncateContent(content, 3);
    expect(result.content.startsWith('abc')).toBe(true);
  });

  it('handles empty string input — returns empty, not truncated', () => {
    const result = truncateContent('', 100);
    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('uses default mimeType of text/plain when not provided', () => {
    const result = truncateContent('hello', 100);
    expect(result.mimeType).toBe('text/plain');
  });

  it('preserves the provided mimeType', () => {
    const result = truncateContent('hello', 100, 'text/csv');
    expect(result.mimeType).toBe('text/csv');
  });
});

// ============================================================================
// extractContent — MIME type mapping
// ============================================================================

describe('extractContent — MIME type resolution', () => {
  beforeEach(() => {
    mockGetFileContent.mockResolvedValue('some content');
  });

  it('maps Google Docs MIME to text/plain in extracted result', async () => {
    const result = await extractContent('file1', 'application/vnd.google-apps.document');
    expect(result.mimeType).toBe('text/plain');
  });

  it('maps Google Sheets MIME to text/csv in extracted result', async () => {
    const result = await extractContent('file1', 'application/vnd.google-apps.spreadsheet');
    expect(result.mimeType).toBe('text/csv');
  });

  it('maps Google Presentations MIME to text/plain in extracted result', async () => {
    const result = await extractContent('file1', 'application/vnd.google-apps.presentation');
    expect(result.mimeType).toBe('text/plain');
  });

  it('maps application/pdf to text/plain in extracted result', async () => {
    const result = await extractContent('file1', 'application/pdf');
    expect(result.mimeType).toBe('text/plain');
  });

  it('preserves text/markdown as-is (text/* passthrough)', async () => {
    const result = await extractContent('file1', 'text/markdown');
    expect(result.mimeType).toBe('text/markdown');
  });

  it('maps unknown non-text MIME type to text/plain', async () => {
    const result = await extractContent('file1', 'application/octet-stream');
    expect(result.mimeType).toBe('text/plain');
  });

  it('calls getFileContent with the correct fileId and mimeType', async () => {
    await extractContent('abc123', 'text/plain');
    expect(mockGetFileContent).toHaveBeenCalledWith('abc123', 'text/plain');
  });

  it('truncates content that exceeds 100,000 chars', async () => {
    const longContent = 'x'.repeat(100_001);
    mockGetFileContent.mockResolvedValue(longContent);
    const result = await extractContent('file1', 'text/plain');
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('... [truncated]');
  });
});
