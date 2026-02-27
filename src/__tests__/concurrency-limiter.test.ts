import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter } from '../concurrency-limiter.js';

describe('ConcurrencyLimiter', () => {
  it('should run tasks immediately when under limit', async () => {
    const limiter = new ConcurrencyLimiter(3);
    const result = await limiter.run(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('should return the task result', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const result = await limiter.run(() => Promise.resolve('hello'));
    expect(result).toBe('hello');
  });

  it('should propagate task errors', async () => {
    const limiter = new ConcurrencyLimiter(2);
    await expect(
      limiter.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });

  it('should release slot after error so subsequent tasks can run', async () => {
    const limiter = new ConcurrencyLimiter(1);
    await expect(
      limiter.run(() => Promise.reject(new Error('fail'))),
    ).rejects.toThrow('fail');

    // Should still be able to run after error
    const result = await limiter.run(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
  });

  it('should enforce concurrency limit', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const makeTask = (delay: number) =>
      limiter.run(
        () =>
          new Promise<void>((resolve) => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            setTimeout(() => {
              currentConcurrent--;
              resolve();
            }, delay);
          }),
      );

    await Promise.all([makeTask(50), makeTask(50), makeTask(50), makeTask(50)]);

    expect(maxConcurrent).toBe(2);
  });

  it('should queue tasks exceeding the limit', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: number[] = [];
    let resolveFirst: () => void;
    const firstBlocks = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const task1 = limiter.run(async () => {
      order.push(1);
      await firstBlocks;
    });

    // task2 should be queued since limit is 1
    const task2Promise = limiter.run(async () => {
      order.push(2);
    });

    // Give microtasks a chance to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(limiter.active).toBe(1);
    expect(limiter.pending).toBe(1);
    expect(order).toEqual([1]);

    // Release first task
    resolveFirst!();
    await task1;
    await task2Promise;

    expect(order).toEqual([1, 2]);
    expect(limiter.active).toBe(0);
    expect(limiter.pending).toBe(0);
  });

  it('should report active and pending counts', async () => {
    const limiter = new ConcurrencyLimiter(1);

    expect(limiter.active).toBe(0);
    expect(limiter.pending).toBe(0);

    let resolveTask: () => void;
    const taskBlocks = new Promise<void>((r) => {
      resolveTask = r;
    });

    const running = limiter.run(() => taskBlocks);
    await new Promise((r) => setTimeout(r, 0));

    expect(limiter.active).toBe(1);

    // Queue another
    const queued = limiter.run(() => Promise.resolve());
    await new Promise((r) => setTimeout(r, 0));

    expect(limiter.pending).toBe(1);

    resolveTask!();
    await running;
    await queued;

    expect(limiter.active).toBe(0);
    expect(limiter.pending).toBe(0);
  });

  it('should handle concurrency of 1 as sequential execution', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: string[] = [];

    await Promise.all([
      limiter.run(async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 20));
        order.push('a-end');
      }),
      limiter.run(async () => {
        order.push('b-start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('b-end');
      }),
    ]);

    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});
