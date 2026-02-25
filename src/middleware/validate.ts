import { type Request, type Response, type NextFunction } from 'express';
import { type ZodType, ZodError } from 'zod';

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Format a ZodError into a single human-readable string.
 * Single missing field → "Missing required field: <name>"
 * Otherwise → first issue message
 */
export function formatZodError(error: ZodError): string {
  const issues = error.issues;
  if (issues.length === 1) {
    const issue = issues[0];
    // Zod v4: invalid_type with undefined input means missing field
    if (
      issue.code === 'invalid_type' &&
      issue.message.includes('received undefined')
    ) {
      const field = issue.path.join('.');
      if (field) return `Missing required field: ${field}`;
    }
    return issue.message;
  }
  // Multiple issues: list them comma-separated
  return issues.map((i) => i.message).join(', ');
}

/**
 * Express middleware factory for Zod schema validation.
 * Validates req.body, req.params, and/or req.query.
 * On failure: returns 400 { error: string }
 * On success: writes parsed (and transformed) values back to req and calls next()
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (schemas.body !== undefined) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        res.status(400).json({ error: formatZodError(result.error) });
        return;
      }
      req.body = result.data;
    }

    if (schemas.params !== undefined) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        res.status(400).json({ error: formatZodError(result.error) });
        return;
      }
      // Use Object.assign to mutate the existing params object in place
      Object.assign(req.params, result.data);
    }

    if (schemas.query !== undefined) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        res.status(400).json({ error: formatZodError(result.error) });
        return;
      }
      // Shadow the req.query getter with an own data property so transformed
      // values (e.g. string→number) are visible downstream via req.query
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    next();
  };
}
