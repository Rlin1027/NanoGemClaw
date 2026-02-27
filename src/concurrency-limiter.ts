/**
 * Lightweight semaphore for limiting concurrent async operations.
 * No external dependencies — uses a simple Promise queue.
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }

  get active(): number {
    return this.running;
  }

  get pending(): number {
    return this.queue.length;
  }
}
