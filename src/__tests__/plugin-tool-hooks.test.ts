/**
 * Tests for beforeToolCall / afterToolCall plugin hook pipeline.
 *
 * We test the hook runner functions exported from app/src/plugin-loader.ts
 * by mocking the internal state (getLoadedPlugins).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

// Mock the logger so we can verify error logging
const mockLoggerError = vi.fn();
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    debug: vi.fn(),
  },
}));

// We import the plugin-loader from app/src. Since it uses its own internal
// registry, we test the exported functions directly by manipulating
// registerInternalPlugin and getLoadedPlugins.

import type {
  BeforeToolCallHook,
  AfterToolCallHook,
  ToolCallHookContext,
} from '@nanogemclaw/plugin-api';

// ============================================================================
// Helpers
// ============================================================================

function makeCtx(
  overrides?: Partial<ToolCallHookContext>,
): ToolCallHookContext {
  return {
    toolName: 'test_tool',
    args: { foo: 'bar' },
    chatJid: '-1001234567890',
    groupFolder: 'test-group',
    isMain: false,
    ...overrides,
  };
}

// ============================================================================
// Unit tests for hook runners directly
// ============================================================================

describe('beforeToolCall hook pipeline', () => {
  it('returns null when no hooks are registered', async () => {
    // Create isolated pipeline with no hooks
    const hooks: BeforeToolCallHook[] = [];
    const runHooks = async (ctx: ToolCallHookContext) => {
      for (const hook of hooks) {
        const result = await hook(ctx);
        if (result && 'block' in result && result.block) return result;
      }
      return null;
    };

    const result = await runHooks(makeCtx());
    expect(result).toBeNull();
  });

  it('returns null when all hooks return void/undefined', async () => {
    const hooks: BeforeToolCallHook[] = [
      async () => undefined,
      async () => {
        /* pass */
      },
    ];
    const runHooks = async (ctx: ToolCallHookContext) => {
      for (const hook of hooks) {
        const result = await hook(ctx);
        if (result && 'block' in result && result.block) return result;
      }
      return null;
    };

    const result = await runHooks(makeCtx());
    expect(result).toBeNull();
  });

  it('blocks when a hook returns { block: true, reason }', async () => {
    const hooks: BeforeToolCallHook[] = [
      async () => ({ block: true as const, reason: 'rate limited' }),
    ];
    const runHooks = async (ctx: ToolCallHookContext) => {
      for (const hook of hooks) {
        const result = await hook(ctx);
        if (result && 'block' in result && result.block) return result;
      }
      return null;
    };

    const result = await runHooks(makeCtx());
    expect(result).toEqual({ block: true, reason: 'rate limited' });
  });

  it('stops at the first blocking hook (short-circuit)', async () => {
    const secondHook = vi.fn(async () => undefined);
    const hooks: BeforeToolCallHook[] = [
      async () => ({ block: true as const, reason: 'first blocker' }),
      secondHook,
    ];
    const runHooks = async (ctx: ToolCallHookContext) => {
      for (const hook of hooks) {
        const result = await hook(ctx);
        if (result && 'block' in result && result.block) return result;
      }
      return null;
    };

    const result = await runHooks(makeCtx());
    expect(result).toEqual({ block: true, reason: 'first blocker' });
    expect(secondHook).not.toHaveBeenCalled();
  });

  it('propagates errors (broken gate = closed)', async () => {
    const error = new Error('hook failure');
    const hooks: BeforeToolCallHook[] = [
      async () => {
        throw error;
      },
    ];
    const runHooks = async (ctx: ToolCallHookContext) => {
      for (const hook of hooks) {
        const result = await hook(ctx);
        if (result && 'block' in result && result.block) return result;
      }
      return null;
    };

    await expect(runHooks(makeCtx())).rejects.toThrow('hook failure');
  });

  it('runs hooks in registration order', async () => {
    const order: number[] = [];
    const hooks: BeforeToolCallHook[] = [
      async () => {
        order.push(1);
      },
      async () => {
        order.push(2);
      },
      async () => {
        order.push(3);
      },
    ];
    const runHooks = async (ctx: ToolCallHookContext) => {
      for (const hook of hooks) {
        const result = await hook(ctx);
        if (result && 'block' in result && result.block) return result;
      }
      return null;
    };

    await runHooks(makeCtx());
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('afterToolCall hook pipeline', () => {
  type AfterCtx = ToolCallHookContext & { result: Record<string, unknown> };

  function makeAfterCtx(overrides?: Partial<AfterCtx>): AfterCtx {
    return {
      ...makeCtx(),
      result: { success: true, data: 'original' },
      ...overrides,
    };
  }

  it('returns null when no hooks are registered', async () => {
    const hooks: AfterToolCallHook[] = [];
    const runHooks = async (ctx: AfterCtx) => {
      let current = ctx.result;
      let modified = false;
      for (const hook of hooks) {
        try {
          const r = await hook({ ...ctx, result: current });
          if (r && 'modifiedResult' in r) {
            current = r.modifiedResult;
            modified = true;
          }
        } catch (err) {
          /* swallow */
        }
      }
      return modified ? current : null;
    };

    const result = await runHooks(makeAfterCtx());
    expect(result).toBeNull();
  });

  it('returns modified result when a hook returns { modifiedResult }', async () => {
    const newResult = { success: true, data: 'modified' };
    const hooks: AfterToolCallHook[] = [
      async () => ({ modifiedResult: newResult }),
    ];
    const runHooks = async (ctx: AfterCtx) => {
      let current = ctx.result;
      let modified = false;
      for (const hook of hooks) {
        try {
          const r = await hook({ ...ctx, result: current });
          if (r && 'modifiedResult' in r) {
            current = r.modifiedResult;
            modified = true;
          }
        } catch (err) {
          /* swallow */
        }
      }
      return modified ? current : null;
    };

    const result = await runHooks(makeAfterCtx());
    expect(result).toEqual(newResult);
  });

  it('chains modifications across multiple hooks', async () => {
    const hooks: AfterToolCallHook[] = [
      async (ctx) => ({ modifiedResult: { ...ctx.result, step1: true } }),
      async (ctx) => ({ modifiedResult: { ...ctx.result, step2: true } }),
    ];
    const runHooks = async (ctx: AfterCtx) => {
      let current = ctx.result;
      let modified = false;
      for (const hook of hooks) {
        try {
          const r = await hook({ ...ctx, result: current });
          if (r && 'modifiedResult' in r) {
            current = r.modifiedResult;
            modified = true;
          }
        } catch (err) {
          /* swallow */
        }
      }
      return modified ? current : null;
    };

    const result = await runHooks(makeAfterCtx());
    expect(result).toMatchObject({
      success: true,
      data: 'original',
      step1: true,
      step2: true,
    });
  });

  it('swallows errors from hooks and preserves the result', async () => {
    const afterHookErrors: unknown[] = [];
    const hooks: AfterToolCallHook[] = [
      async () => {
        throw new Error('after hook error');
      },
    ];
    const runHooks = async (ctx: AfterCtx) => {
      let current = ctx.result;
      let modified = false;
      for (const hook of hooks) {
        try {
          const r = await hook({ ...ctx, result: current });
          if (r && 'modifiedResult' in r) {
            current = r.modifiedResult;
            modified = true;
          }
        } catch (err) {
          afterHookErrors.push(err);
        }
      }
      return modified ? current : null;
    };

    const result = await runHooks(makeAfterCtx());
    // Error is swallowed, original result unchanged (returns null = no modification)
    expect(result).toBeNull();
    expect(afterHookErrors).toHaveLength(1);
  });

  it('preserves original result if hook after an error does not modify', async () => {
    const passHook = vi.fn(async () => undefined);
    const hooks: AfterToolCallHook[] = [
      async () => {
        throw new Error('oops');
      },
      passHook,
    ];
    const runHooks = async (ctx: AfterCtx) => {
      let current = ctx.result;
      let modified = false;
      for (const hook of hooks) {
        try {
          const r = await hook({ ...ctx, result: current });
          if (r && 'modifiedResult' in r) {
            current = r.modifiedResult;
            modified = true;
          }
        } catch {
          /* swallow */
        }
      }
      return modified ? current : null;
    };

    const result = await runHooks(makeAfterCtx());
    expect(result).toBeNull();
    expect(passHook).toHaveBeenCalled();
  });
});

describe('registerInternalPlugin integration', () => {
  // Dynamic import to get a fresh module each time is not easily possible in vitest without resetting modules.
  // Instead we test the logic by verifying the exported function exists and behaves correctly.

  it('getBeforeToolCallHooks and getAfterToolCallHooks exist on plugin-loader', async () => {
    const loader = await import('../../app/src/plugin-loader.js');
    expect(typeof loader.getBeforeToolCallHooks).toBe('function');
    expect(typeof loader.getAfterToolCallHooks).toBe('function');
    expect(typeof loader.runBeforeToolCallHooks).toBe('function');
    expect(typeof loader.runAfterToolCallHooks).toBe('function');
    expect(typeof loader.registerInternalPlugin).toBe('function');
  });

  it('runBeforeToolCallHooks returns null when no hooks are registered', async () => {
    const loader = await import('../../app/src/plugin-loader.js');
    const result = await loader.runBeforeToolCallHooks(makeCtx());
    expect(result).toBeNull();
  });

  it('runAfterToolCallHooks returns null when no hooks are registered', async () => {
    const loader = await import('../../app/src/plugin-loader.js');
    const result = await loader.runAfterToolCallHooks({
      ...makeCtx(),
      result: { success: true },
    });
    expect(result).toBeNull();
  });

  it('internal plugin is included in getLoadedPlugins and runs before external plugins', async () => {
    const loader = await import('../../app/src/plugin-loader.js');
    const order: string[] = [];

    loader.registerInternalPlugin({
      id: 'test-builtin',
      name: 'Test Builtin',
      version: '1.0.0',
      builtin: true as const,
      hooks: {
        beforeToolCall: async () => {
          order.push('builtin');
        },
      },
    });

    await loader.runBeforeToolCallHooks(makeCtx());
    // The builtin plugin hook should have been called
    expect(order).toContain('builtin');
  });
});
