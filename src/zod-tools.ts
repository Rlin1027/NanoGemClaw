/**
 * Zod Tool Validation Utilities
 *
 * Provides validateToolInput() for validating tool args against any schema
 * with a .parse() method (Zod, Arktype, custom validators), and
 * zodToGeminiParameters() for converting Zod object schemas to Gemini's
 * FunctionDeclaration parameters format.
 *
 * Targets Zod v4 internal _def structure:
 *   - _def.type (string) — not _def.typeName
 *   - _def.shape (plain object) — not a function
 *   - _def.element — array item type
 *   - _def.entries — enum entries object
 *   - _def.innerType — optional/nullable wrapper
 */

import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

/** Structural type matching any schema with a .parse() method */
export interface ParseableSchema {
  parse(data: unknown): unknown;
}

export interface ValidationResult {
  valid: boolean;
  /** Parsed/transformed data on success */
  data?: Record<string, unknown>;
  /** Human-readable error message on failure */
  error?: string;
}

// ============================================================================
// validateToolInput
// ============================================================================

/**
 * Validate tool input args against a schema with a .parse() method.
 * Returns parsed/transformed data on success, error message on failure.
 * If schema does not have a .parse() method, returns { valid: true } (pass-through).
 */
export function validateToolInput(
  schema: ParseableSchema,
  args: Record<string, unknown>,
): ValidationResult {
  if (typeof schema?.parse !== 'function') {
    return { valid: true, data: args };
  }

  try {
    const parsed = schema.parse(args);
    return {
      valid: true,
      data: (parsed as Record<string, unknown>) ?? args,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}

// ============================================================================
// zodToGeminiParameters — Zod v4 implementation
// ============================================================================

/**
 * Convert a Zod object schema to Gemini FunctionDeclaration parameters format.
 * Returns null if conversion fails (caller should use manual `parameters`).
 *
 * Supports: z.string, z.number, z.boolean, z.enum, z.array, z.object,
 *           z.optional, z.nullable.
 * Returns null for any unsupported Zod type.
 */
export function zodToGeminiParameters(
  schema: unknown,
): Record<string, unknown> | null {
  if (!isZodLike(schema)) return null;

  const def = (schema as ZodLike)._def;
  if (!def || def.type !== 'object') {
    if (def) {
      logger.warn(
        `zodToGeminiParameters: top-level schema must be ZodObject, got "${def.type}"`,
      );
    }
    return null;
  }

  return convertZodObject(schema as ZodLike);
}

// ============================================================================
// Internal types & helpers
// ============================================================================

interface ZodDef {
  type: string;
  shape?: Record<string, ZodLike>;
  innerType?: ZodLike;
  element?: ZodLike; // array item
  entries?: Record<string, string>; // enum entries
  options?: unknown[]; // union options
}

interface ZodLike {
  _def: ZodDef;
}

function isZodLike(val: unknown): val is ZodLike {
  return (
    val !== null &&
    typeof val === 'object' &&
    '_def' in (val as object) &&
    typeof (val as ZodLike)._def?.type === 'string'
  );
}

/** Unwrap ZodOptional and ZodNullable layers, returning the inner schema and flags */
function unwrapSchema(schema: ZodLike): {
  inner: ZodLike;
  optional: boolean;
  nullable: boolean;
} {
  let inner = schema;
  let optional = false;
  let nullable = false;

  let safety = 0;
  while (safety++ < 10) {
    const t = inner._def.type;
    if (t === 'optional') {
      optional = true;
      inner = inner._def.innerType!;
    } else if (t === 'nullable') {
      nullable = true;
      inner = inner._def.innerType!;
    } else {
      break;
    }
  }

  return { inner, optional, nullable };
}

/**
 * Convert a single Zod field schema to a Gemini property descriptor.
 * Returns null for unsupported types.
 */
function convertZodField(schema: ZodLike): Record<string, unknown> | null {
  const { inner, nullable } = unwrapSchema(schema);
  const t = inner._def.type;

  let result: Record<string, unknown> | null = null;

  switch (t) {
    case 'string':
      result = { type: 'STRING' };
      break;

    case 'number':
      result = { type: 'NUMBER' };
      break;

    case 'boolean':
      result = { type: 'BOOLEAN' };
      break;

    case 'enum': {
      const entries = inner._def.entries;
      if (!entries) {
        logger.warn(
          'zodToGeminiParameters: Unsupported Zod type: enum (no entries), skipping zodToGeminiParameters conversion',
        );
        return null;
      }
      const enumValues = Object.values(entries);
      result = { type: 'STRING', enum: enumValues };
      break;
    }

    case 'array': {
      const elementSchema = inner._def.element;
      if (!elementSchema) {
        logger.warn(
          'zodToGeminiParameters: ZodArray missing element type, skipping zodToGeminiParameters conversion',
        );
        return null;
      }
      const itemResult = convertZodField(elementSchema);
      if (!itemResult) return null;
      result = { type: 'ARRAY', items: itemResult };
      break;
    }

    case 'object': {
      result = convertZodObject(inner);
      break;
    }

    default: {
      logger.warn(
        `zodToGeminiParameters: Unsupported Zod type: ${t}, skipping zodToGeminiParameters conversion`,
      );
      return null;
    }
  }

  if (result && nullable) {
    result = { ...result, nullable: true };
  }

  return result;
}

/**
 * Convert a ZodObject to a Gemini OBJECT parameter descriptor.
 */
function convertZodObject(schema: ZodLike): Record<string, unknown> | null {
  const shape = schema._def.shape;
  if (!shape || typeof shape !== 'object') return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const { optional } = unwrapSchema(fieldSchema);
    const converted = convertZodField(fieldSchema);
    if (!converted) {
      // Any unsupported field causes the whole conversion to return null
      return null;
    }
    properties[key] = converted;
    if (!optional) {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: 'OBJECT',
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return result;
}
