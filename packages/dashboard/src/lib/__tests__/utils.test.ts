import { describe, it, expect } from 'vitest';
import { cn } from '../utils';

describe('cn', () => {
    it('returns a single class string unchanged', () => {
        expect(cn('foo')).toBe('foo');
    });

    it('joins multiple class strings', () => {
        const result = cn('foo', 'bar');
        expect(result).toContain('foo');
        expect(result).toContain('bar');
    });

    it('filters out falsy values', () => {
        const result = cn('foo', false, undefined, null, 'bar');
        expect(result).toContain('foo');
        expect(result).toContain('bar');
        expect(result).not.toContain('false');
        expect(result).not.toContain('null');
    });

    it('merges conflicting Tailwind classes (last wins)', () => {
        const result = cn('bg-red-500', 'bg-blue-500');
        expect(result).toBe('bg-blue-500');
    });
});
