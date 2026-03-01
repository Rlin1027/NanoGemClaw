import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus, createEventBus, getEventBus, resetEventBus } from '../index.js';

vi.mock('@nanogemclaw/core', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.destroy();
  });

  // ── emit / on ──────────────────────────────────────────────────────

  describe('emit and on', () => {
    it('should deliver payload to handler', () => {
      const handler = vi.fn();
      bus.on('system:ready', handler);
      bus.emit('system:ready', {} as Record<string, never>);
      expect(handler).toHaveBeenCalledWith({});
    });

    it('should deliver to multiple handlers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('system:ready', h1);
      bus.on('system:ready', h2);
      bus.emit('system:ready', {} as Record<string, never>);
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('should pass correct payload shape', () => {
      const handler = vi.fn();
      bus.on('message:received', handler);
      const payload = {
        chatId: '123',
        sender: 'user1',
        senderName: 'User',
        content: 'hello',
        timestamp: '2024-01-01T00:00:00Z',
        groupFolder: 'test-group',
      };
      bus.emit('message:received', payload);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('should not fire handler for different events', () => {
      const handler = vi.fn();
      bus.on('system:ready', handler);
      bus.emit('system:shutdown', {} as Record<string, never>);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── error isolation ────────────────────────────────────────────────

  describe('error isolation', () => {
    it('should not propagate sync errors to other handlers', () => {
      const h1 = vi.fn(() => {
        throw new Error('boom');
      });
      const h2 = vi.fn();
      bus.on('system:ready', h1);
      bus.on('system:ready', h2);
      bus.emit('system:ready', {} as Record<string, never>);
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });

    it('should log sync handler errors', async () => {
      const { logger } = await import('@nanogemclaw/core');
      bus.on('system:ready', () => {
        throw new Error('sync boom');
      });
      bus.emit('system:ready', {} as Record<string, never>);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'system:ready' }),
        'Event handler threw',
      );
    });

    it('should log async handler rejections', async () => {
      const { logger } = await import('@nanogemclaw/core');
      bus.on('system:ready', async () => {
        throw new Error('async boom');
      });
      bus.emit('system:ready', {} as Record<string, never>);
      // Wait for microtask to settle
      await new Promise((r) => setTimeout(r, 10));
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'system:ready' }),
        'Async event handler rejected',
      );
    });
  });

  // ── once ───────────────────────────────────────────────────────────

  describe('once', () => {
    it('should fire handler only once', () => {
      const handler = vi.fn();
      bus.once('system:ready', handler);
      bus.emit('system:ready', {} as Record<string, never>);
      bus.emit('system:ready', {} as Record<string, never>);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should be removable before firing', () => {
      const handler = vi.fn();
      const unsub = bus.once('system:ready', handler);
      unsub();
      bus.emit('system:ready', {} as Record<string, never>);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── off / unsubscribe ──────────────────────────────────────────────

  describe('off / unsubscribe', () => {
    it('should unsubscribe via returned function', () => {
      const handler = vi.fn();
      const unsub = bus.on('system:ready', handler);
      unsub();
      bus.emit('system:ready', {} as Record<string, never>);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should unsubscribe via off()', () => {
      const handler = vi.fn();
      bus.on('system:ready', handler);
      bus.off('system:ready', handler);
      bus.emit('system:ready', {} as Record<string, never>);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── ring buffer ────────────────────────────────────────────────────

  describe('ring buffer', () => {
    it('should record events in buffer', () => {
      bus.emit('system:ready', {} as Record<string, never>);
      const buffer = bus.getBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].event).toBe('system:ready');
      expect(buffer[0].timestamp).toBeGreaterThan(0);
    });

    it('should cap buffer at configured size', () => {
      const smallBus = new EventBus({ bufferSize: 3 });
      smallBus.emit('system:ready', {} as Record<string, never>);
      smallBus.emit('system:ready', {} as Record<string, never>);
      smallBus.emit('system:ready', {} as Record<string, never>);
      smallBus.emit('system:shutdown', {} as Record<string, never>);
      const buffer = smallBus.getBuffer();
      expect(buffer).toHaveLength(3);
      expect(buffer[2].event).toBe('system:shutdown');
      smallBus.destroy();
    });

    it('should drop oldest events on overflow', () => {
      const smallBus = new EventBus({ bufferSize: 2 });
      smallBus.emit('system:ready', {} as Record<string, never>);
      smallBus.emit('system:shutdown', {} as Record<string, never>);
      smallBus.emit('message:sent', {
        chatId: '1',
        content: 'hi',
        timestamp: '',
        groupFolder: 'g',
      });
      expect(smallBus.getBufferSize()).toBe(2);
      expect(smallBus.getBuffer()[0].event).toBe('system:shutdown');
      smallBus.destroy();
    });

    it('should clear buffer without removing listeners', () => {
      const handler = vi.fn();
      bus.on('system:ready', handler);
      bus.emit('system:ready', {} as Record<string, never>);
      expect(bus.getBufferSize()).toBe(1);
      bus.clearBuffer();
      expect(bus.getBufferSize()).toBe(0);
      // Listener should still work
      bus.emit('system:ready', {} as Record<string, never>);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  // ── listenerCount ──────────────────────────────────────────────────

  describe('listenerCount', () => {
    it('should return correct count', () => {
      bus.on('system:ready', vi.fn());
      bus.on('system:ready', vi.fn());
      expect(bus.listenerCount('system:ready')).toBe(2);
    });

    it('should return 0 for events with no listeners', () => {
      expect(bus.listenerCount('system:shutdown')).toBe(0);
    });
  });

  // ── removeAllListeners ─────────────────────────────────────────────

  describe('removeAllListeners', () => {
    it('should remove all listeners for a specific event', () => {
      bus.on('system:ready', vi.fn());
      bus.on('system:shutdown', vi.fn());
      bus.removeAllListeners('system:ready');
      expect(bus.listenerCount('system:ready')).toBe(0);
      expect(bus.listenerCount('system:shutdown')).toBe(1);
    });

    it('should remove all listeners when no event specified', () => {
      bus.on('system:ready', vi.fn());
      bus.on('system:shutdown', vi.fn());
      bus.removeAllListeners();
      expect(bus.listenerCount('system:ready')).toBe(0);
      expect(bus.listenerCount('system:shutdown')).toBe(0);
    });
  });

  // ── destroy ────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should remove all listeners and clear buffer', () => {
      bus.on('system:ready', vi.fn());
      bus.emit('system:ready', {} as Record<string, never>);
      bus.destroy();
      expect(bus.listenerCount('system:ready')).toBe(0);
      expect(bus.getBufferSize()).toBe(0);
    });
  });
});

// ── Singleton ──────────────────────────────────────────────────────────

describe('Singleton', () => {
  afterEach(() => {
    resetEventBus();
  });

  it('should create and return instance', () => {
    const bus = createEventBus();
    expect(bus).toBeInstanceOf(EventBus);
  });

  it('should return same instance on subsequent calls', () => {
    const bus1 = createEventBus();
    const bus2 = createEventBus();
    expect(bus1).toBe(bus2);
  });

  it('should throw when getEventBus called before create', () => {
    expect(() => getEventBus()).toThrow('EventBus not initialized');
  });

  it('should return instance via getEventBus after create', () => {
    const bus = createEventBus();
    expect(getEventBus()).toBe(bus);
  });

  it('should reset instance', () => {
    createEventBus();
    resetEventBus();
    expect(() => getEventBus()).toThrow();
  });

  it('should allow creating new instance after reset', () => {
    const bus1 = createEventBus();
    resetEventBus();
    const bus2 = createEventBus();
    expect(bus2).not.toBe(bus1);
  });
});
