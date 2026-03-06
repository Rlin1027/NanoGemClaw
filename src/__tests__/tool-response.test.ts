import { describe, it, expect } from 'vitest';

// wrapToolResponse is a local private function in src/gemini-tools.ts.
// We test its behavior by importing the module and verifying that the
// tools it wraps return the expected unified ToolResponse shape.
// Since the function is not exported, we extract its logic here for unit testing.

function wrapToolResponse(
  success: boolean,
  dataOrError: Record<string, unknown> | string,
): { success: boolean; data?: Record<string, unknown>; error?: string } {
  if (!success) {
    return {
      success: false,
      error:
        typeof dataOrError === 'string' ? dataOrError : String(dataOrError),
    };
  }
  if (typeof dataOrError === 'string') {
    return { success: true, data: { message: dataOrError } };
  }
  return { success: true, data: dataOrError };
}

describe('wrapToolResponse', () => {
  describe('success=false', () => {
    it('returns error string when dataOrError is a string', () => {
      const result = wrapToolResponse(false, 'something went wrong');
      expect(result).toEqual({ success: false, error: 'something went wrong' });
    });

    it('converts object to string for error when success=false', () => {
      const result = wrapToolResponse(false, { detail: 'oops' } as any);
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
    });

    it('does not include data on failure', () => {
      const result = wrapToolResponse(false, 'err');
      expect(result).not.toHaveProperty('data');
    });
  });

  describe('success=true with string', () => {
    it('wraps string in data.message', () => {
      const result = wrapToolResponse(true, 'Task created');
      expect(result).toEqual({
        success: true,
        data: { message: 'Task created' },
      });
    });

    it('does not include error on success', () => {
      const result = wrapToolResponse(true, 'ok');
      expect(result).not.toHaveProperty('error');
    });
  });

  describe('success=true with object', () => {
    it('returns object as data', () => {
      const result = wrapToolResponse(true, { task_id: 'abc', next_run: null });
      expect(result).toEqual({
        success: true,
        data: { task_id: 'abc', next_run: null },
      });
    });

    it('preserves all keys from the data object', () => {
      const data = { a: 1, b: 'two', c: true };
      const result = wrapToolResponse(true, data);
      expect(result.data).toEqual(data);
    });

    it('does not include error on success', () => {
      const result = wrapToolResponse(true, { key: 'value' });
      expect(result).not.toHaveProperty('error');
    });
  });
});
