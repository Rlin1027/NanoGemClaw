import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateToolInput, zodToGeminiParameters } from '../zod-tools.js';

// Mock the logger to suppress output in tests
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('validateToolInput', () => {
  describe('with a real Zod schema', () => {
    it('returns valid=true and parsed data for valid input', async () => {
      const { z } = await import('zod');
      const schema = z.object({
        name: z.string(),
        count: z.number(),
      });

      const result = validateToolInput(schema, { name: 'test', count: 42 });
      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ name: 'test', count: 42 });
      expect(result.error).toBeUndefined();
    });

    it('returns valid=false with error message for invalid input', async () => {
      const { z } = await import('zod');
      const schema = z.object({
        name: z.string(),
      });

      const result = validateToolInput(schema, { name: 123 as unknown as string });
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });

    it('returns valid=false when required field is missing', async () => {
      const { z } = await import('zod');
      const schema = z.object({
        required_field: z.string(),
      });

      const result = validateToolInput(schema, {});
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns parsed/transformed data when Zod transforms are used', async () => {
      const { z } = await import('zod');
      const schema = z.object({
        value: z.string().transform((s) => s.toUpperCase()),
      });

      const result = validateToolInput(schema, { value: 'hello' });
      expect(result.valid).toBe(true);
      expect((result.data as Record<string, unknown>).value).toBe('HELLO');
    });

    it('allows optional fields to be missing', async () => {
      const { z } = await import('zod');
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result = validateToolInput(schema, { required: 'yes' });
      expect(result.valid).toBe(true);
      expect(result.data).toMatchObject({ required: 'yes' });
    });
  });

  describe('with a non-Zod schema with .parse() method', () => {
    it('passes through when parse() succeeds', () => {
      const customSchema = {
        parse(data: unknown) {
          return data; // pass-through validator
        },
      };

      const args = { foo: 'bar' };
      const result = validateToolInput(customSchema, args);
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(args);
    });

    it('returns valid=false when parse() throws', () => {
      const customSchema = {
        parse(_data: unknown): unknown {
          throw new Error('Custom validation error');
        },
      };

      const result = validateToolInput(customSchema, { foo: 'bar' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Custom validation error');
    });
  });

  describe('edge cases', () => {
    it('returns valid=true (pass-through) when schema has no .parse method', () => {
      const notASchema = {} as { parse: (d: unknown) => unknown };
      const args = { x: 1 };
      const result = validateToolInput(notASchema, args);
      expect(result.valid).toBe(true);
    });

    it('handles non-Error thrown from parse()', () => {
      const schema = {
        parse(_data: unknown): unknown {
          throw 'string error'; // eslint-disable-line no-throw-literal
        },
      };
      const result = validateToolInput(schema, {});
      expect(result.valid).toBe(false);
      expect(result.error).toBe('string error');
    });
  });
});

describe('zodToGeminiParameters', () => {
  it('converts z.object with string field', async () => {
    const { z } = await import('zod');
    const schema = z.object({ name: z.string() });
    const result = zodToGeminiParameters(schema);
    expect(result).toEqual({
      type: 'OBJECT',
      properties: { name: { type: 'STRING' } },
      required: ['name'],
    });
  });

  it('converts z.object with number field', async () => {
    const { z } = await import('zod');
    const schema = z.object({ count: z.number() });
    const result = zodToGeminiParameters(schema);
    expect(result).toEqual({
      type: 'OBJECT',
      properties: { count: { type: 'NUMBER' } },
      required: ['count'],
    });
  });

  it('converts z.object with boolean field', async () => {
    const { z } = await import('zod');
    const schema = z.object({ flag: z.boolean() });
    const result = zodToGeminiParameters(schema);
    expect(result).toEqual({
      type: 'OBJECT',
      properties: { flag: { type: 'BOOLEAN' } },
      required: ['flag'],
    });
  });

  it('converts z.enum to STRING with enum values', async () => {
    const { z } = await import('zod');
    const schema = z.object({ color: z.enum(['red', 'green', 'blue']) });
    const result = zodToGeminiParameters(schema);
    expect(result).toMatchObject({
      type: 'OBJECT',
      properties: {
        color: { type: 'STRING', enum: ['red', 'green', 'blue'] },
      },
    });
  });

  it('converts z.array(z.string()) to ARRAY with items', async () => {
    const { z } = await import('zod');
    const schema = z.object({ tags: z.array(z.string()) });
    const result = zodToGeminiParameters(schema);
    expect(result).toEqual({
      type: 'OBJECT',
      properties: { tags: { type: 'ARRAY', items: { type: 'STRING' } } },
      required: ['tags'],
    });
  });

  it('converts nested z.object recursively', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      address: z.object({ city: z.string(), zip: z.string() }),
    });
    const result = zodToGeminiParameters(schema);
    expect(result).toEqual({
      type: 'OBJECT',
      properties: {
        address: {
          type: 'OBJECT',
          properties: { city: { type: 'STRING' }, zip: { type: 'STRING' } },
          required: ['city', 'zip'],
        },
      },
      required: ['address'],
    });
  });

  it('marks optional fields as not required', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });
    const result = zodToGeminiParameters(schema);
    expect(result?.required).toEqual(['required']);
    expect(Object.keys((result?.properties as Record<string, unknown>) ?? {})).toContain('optional');
  });

  it('adds nullable: true for z.nullable fields', async () => {
    const { z } = await import('zod');
    const schema = z.object({ value: z.string().nullable() });
    const result = zodToGeminiParameters(schema);
    expect((result?.properties as Record<string, unknown>)?.value).toMatchObject({
      type: 'STRING',
      nullable: true,
    });
  });

  it('returns null for non-object top-level schema', async () => {
    const { z } = await import('zod');
    const schema = z.string();
    const result = zodToGeminiParameters(schema);
    expect(result).toBeNull();
  });

  it('returns null for unsupported Zod type (z.union) and logs warning', async () => {
    const { z } = await import('zod');
    const { logger } = await import('../logger.js');
    const schema = z.object({ value: z.union([z.string(), z.number()]) });
    const result = zodToGeminiParameters(schema);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns null for unsupported z.record type', async () => {
    const { z } = await import('zod');
    const schema = z.object({ map: z.record(z.string()) });
    const result = zodToGeminiParameters(schema);
    expect(result).toBeNull();
  });

  it('returns null for z.literal type', async () => {
    const { z } = await import('zod');
    const schema = z.object({ fixed: z.literal('hello') });
    const result = zodToGeminiParameters(schema);
    expect(result).toBeNull();
  });

  it('returns null for non-Zod object input', () => {
    const result = zodToGeminiParameters({ not: 'a schema' });
    expect(result).toBeNull();
  });

  it('returns null for null input', () => {
    const result = zodToGeminiParameters(null);
    expect(result).toBeNull();
  });

  it('returns null for primitive input', () => {
    const result = zodToGeminiParameters('string');
    expect(result).toBeNull();
  });

  it('omits required array when all fields are optional', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      a: z.string().optional(),
      b: z.number().optional(),
    });
    const result = zodToGeminiParameters(schema);
    expect(result?.required).toBeUndefined();
  });
});
