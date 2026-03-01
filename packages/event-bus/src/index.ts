export type { NanoEventMap } from './types.js';
export { EventBus } from './event-bus.js';
export type { EventBusOptions, EventRecord } from './event-bus.js';

import { EventBus, type EventBusOptions } from './event-bus.js';

let instance: EventBus | null = null;

/** Create the singleton EventBus. Subsequent calls return the same instance. */
export function createEventBus(options?: EventBusOptions): EventBus {
  if (!instance) {
    instance = new EventBus(options);
  }
  return instance;
}

/** Get the singleton EventBus. Throws if not yet initialized. */
export function getEventBus(): EventBus {
  if (!instance) {
    throw new Error('EventBus not initialized. Call createEventBus() first.');
  }
  return instance;
}

/** Destroy and reset the singleton. Intended for tests. */
export function resetEventBus(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
