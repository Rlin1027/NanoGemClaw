import { describe, it, expect } from 'vitest';
import {
    SAFE_FOLDER_RE,
    validateFolderName,
    escapeFts5Query,
    stripControlChars,
} from '../validate.js';

describe('SAFE_FOLDER_RE', () => {
    it('allows alphanumeric names', () => {
        expect(SAFE_FOLDER_RE.test('mygroup123')).toBe(true);
    });

    it('allows underscores and hyphens', () => {
        expect(SAFE_FOLDER_RE.test('my_group-name')).toBe(true);
    });

    it('rejects path traversal sequences', () => {
        expect(SAFE_FOLDER_RE.test('../etc')).toBe(false);
        expect(SAFE_FOLDER_RE.test('../../secret')).toBe(false);
    });

    it('rejects spaces', () => {
        expect(SAFE_FOLDER_RE.test('my group')).toBe(false);
    });

    it('rejects forward slashes', () => {
        expect(SAFE_FOLDER_RE.test('foo/bar')).toBe(false);
    });

    it('rejects backslashes', () => {
        expect(SAFE_FOLDER_RE.test('foo\\bar')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(SAFE_FOLDER_RE.test('')).toBe(false);
    });
});

describe('validateFolderName', () => {
    it('returns the folder name if valid', () => {
        expect(validateFolderName('valid-folder_123')).toBe('valid-folder_123');
    });

    it('throws on path traversal', () => {
        expect(() => validateFolderName('../etc')).toThrow();
    });

    it('throws on spaces', () => {
        expect(() => validateFolderName('my folder')).toThrow();
    });

    it('throws on slashes', () => {
        expect(() => validateFolderName('foo/bar')).toThrow();
    });

    it('throws on empty string', () => {
        expect(() => validateFolderName('')).toThrow();
    });
});

describe('escapeFts5Query', () => {
    it('wraps single token in double quotes', () => {
        expect(escapeFts5Query('hello')).toBe('"hello"');
    });

    it('returns empty quoted string for empty input', () => {
        expect(escapeFts5Query('')).toBe('""');
    });

    it('returns empty quoted string for whitespace-only input', () => {
        expect(escapeFts5Query('   ')).toBe('""');
    });

    it('joins multiple tokens with OR', () => {
        expect(escapeFts5Query('foo bar')).toBe('"foo" OR "bar"');
    });

    it('escapes internal double quotes', () => {
        expect(escapeFts5Query('say "hello"')).toBe('"say" OR """hello"""');
    });

    it('strips FTS5 special characters', () => {
        const result = escapeFts5Query('hello*world');
        expect(result).toBe('"helloworld"');
    });

    it('handles Chinese/multi-byte tokens', () => {
        const result = escapeFts5Query('你好 世界');
        expect(result).toBe('"你好" OR "世界"');
    });
});

describe('stripControlChars', () => {
    it('removes NUL character', () => {
        expect(stripControlChars('hello\x00world')).toBe('helloworld');
    });

    it('removes BEL character', () => {
        expect(stripControlChars('hello\x07world')).toBe('helloworld');
    });

    it('removes BS character', () => {
        expect(stripControlChars('hello\x08world')).toBe('helloworld');
    });

    it('removes DEL character (0x7F)', () => {
        expect(stripControlChars('hello\x7Fworld')).toBe('helloworld');
    });

    it('removes C1 control characters (0x80-0x9F)', () => {
        expect(stripControlChars('hello\x80world')).toBe('helloworld');
        expect(stripControlChars('hello\x9Fworld')).toBe('helloworld');
    });

    it('preserves normal text', () => {
        expect(stripControlChars('Hello, World! 123')).toBe('Hello, World! 123');
    });

    it('preserves newlines and tabs (0x0A, 0x09 are C0 — actually strips them)', () => {
        // \n is 0x0A (C0), \t is 0x09 (C0) — both are stripped by the regex
        expect(stripControlChars('hello\nworld')).toBe('helloworld');
        expect(stripControlChars('hello\tworld')).toBe('helloworld');
    });

    it('handles mixed content with control chars and normal text', () => {
        expect(stripControlChars('\x00hello\x07 \x1Fworld\x7F')).toBe('hello world');
    });

    it('returns empty string unchanged', () => {
        expect(stripControlChars('')).toBe('');
    });
});
