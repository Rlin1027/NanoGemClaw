/**
 * EventBus — Type-safe event bus wrapping Node.js EventEmitter.
 *
 * - emit() synchronously triggers all handlers
 * - Each handler is independently try/caught; errors don't propagate
 * - Async handler rejections are logged, never crash the process
 * - Ring buffer retains the most recent N events
 */
import { EventEmitter } from 'node:events';
import { logger } from '@nanogemclaw/core';
import type { NanoEventMap } from './types.js';

export interface EventRecord {
  event: string;
  payload: unknown;
  timestamp: number;
}

export interface EventBusOptions {
  /** Number of events to retain in the ring buffer (default: 100) */
  bufferSize?: number;
  /** Max listeners per event before warning (default: 50) */
  maxListeners?: number;
}

export class EventBus {
  private emitter: EventEmitter;
  private ringBuffer: (EventRecord | null)[];
  private writeIndex = 0;
  private count = 0;
  private readonly bufferSize: number;

  constructor(options?: EventBusOptions) {
    this.emitter = new EventEmitter();
    this.bufferSize = options?.bufferSize ?? 100;
    this.emitter.setMaxListeners(options?.maxListeners ?? 50);
    this.ringBuffer = new Array(this.bufferSize).fill(null);
  }

  /**
   * Emit an event to all registered handlers.
   * Each handler runs in its own try/catch — one failure won't block others.
   */
  emit<K extends keyof NanoEventMap>(event: K, payload: NanoEventMap[K]): void {
    // O(1) circular buffer write — no shift() needed
    this.ringBuffer[this.writeIndex] = { event: event as string, payload, timestamp: Date.now() };
    this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    if (this.count < this.bufferSize) this.count++;

    // Use rawListeners() to correctly handle once() wrappers
    const listeners = this.emitter.rawListeners(event as string);
    for (const listener of listeners) {
      try {
        const result = (listener as (...args: unknown[]) => unknown)(payload);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            logger.error({ event, err }, 'Async event handler rejected');
          });
        }
      } catch (err) {
        logger.error({ event, err }, 'Event handler threw');
      }
    }
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof NanoEventMap>(
    event: K,
    handler: (payload: NanoEventMap[K]) => void | Promise<void>,
  ): () => void {
    this.emitter.on(event as string, handler);
    return () => {
      this.emitter.removeListener(event as string, handler);
    };
  }

  /**
   * Subscribe to an event, firing at most once.
   * Without handler: returns a Promise that resolves with the next payload.
   * With handler: returns an unsubscribe function.
   */
  once<K extends keyof NanoEventMap>(event: K): Promise<NanoEventMap[K]>;
  once<K extends keyof NanoEventMap>(
    event: K,
    handler: (payload: NanoEventMap[K]) => void | Promise<void>,
  ): () => void;
  once<K extends keyof NanoEventMap>(
    event: K,
    handler?: (payload: NanoEventMap[K]) => void | Promise<void>,
  ): Promise<NanoEventMap[K]> | (() => void) {
    if (!handler) {
      return new Promise<NanoEventMap[K]>((resolve) => {
        this.emitter.once(event as string, resolve);
      });
    }
    this.emitter.once(event as string, handler);
    return () => {
      this.emitter.removeListener(event as string, handler);
    };
  }

  /**
   * Remove a specific handler from an event.
   */
  off<K extends keyof NanoEventMap>(
    event: K,
    handler: (payload: NanoEventMap[K]) => void | Promise<void>,
  ): void {
    this.emitter.removeListener(event as string, handler);
  }

  /** Get a copy of the event buffer in chronological order. */
  getBuffer(): ReadonlyArray<EventRecord> {
    if (this.count === 0) return [];
    const result: EventRecord[] = [];
    const start = this.count < this.bufferSize ? 0 : this.writeIndex;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.bufferSize;
      const record = this.ringBuffer[idx];
      if (record) result.push(record);
    }
    return result;
  }

  /** Current number of events in the buffer. */
  getBufferSize(): number {
    return this.count;
  }

  /** Number of listeners for a specific event. */
  listenerCount<K extends keyof NanoEventMap>(event: K): number {
    return this.emitter.listenerCount(event as string);
  }

  /** Remove all listeners, optionally for a specific event. */
  removeAllListeners<K extends keyof NanoEventMap>(event?: K): void {
    if (event) {
      this.emitter.removeAllListeners(event as string);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /** Clear the event buffer without removing listeners. */
  clearBuffer(): void {
    this.ringBuffer = new Array(this.bufferSize).fill(null);
    this.writeIndex = 0;
    this.count = 0;
  }

  /** Remove all listeners and clear the buffer. */
  destroy(): void {
    this.emitter.removeAllListeners();
    this.ringBuffer = new Array(this.bufferSize).fill(null);
    this.writeIndex = 0;
    this.count = 0;
  }
}
