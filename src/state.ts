/**
 * Shared State Management for NanoGemClaw
 * Centralizes all module-level mutable state and bot instance.
 */
import TelegramBot from 'node-telegram-bot-api';
import { RegisteredGroup, Session } from './types.js';

// ============================================================================
// Bot Instance
// ============================================================================

let bot: TelegramBot;

export function getBot(): TelegramBot {
  return bot;
}

export function setBot(b: TelegramBot): void {
  bot = b;
}

// ============================================================================
// Sessions
// ============================================================================

let sessions: Session = {};

export function getSessions(): Session {
  return sessions;
}

export function setSessions(s: Session): void {
  sessions = s;
}

// ============================================================================
// Registered Groups
// ============================================================================

let registeredGroups: Record<string, RegisteredGroup> = {};

export function getRegisteredGroups(): Record<string, RegisteredGroup> {
  return registeredGroups;
}

export function setRegisteredGroups(g: Record<string, RegisteredGroup>): void {
  registeredGroups = g;
}

// ============================================================================
// Last Agent Timestamp (per chat)
// ============================================================================

let lastAgentTimestamp: Record<string, string> = {};

export function getLastAgentTimestamp(): Record<string, string> {
  return lastAgentTimestamp;
}

export function setLastAgentTimestamp(t: Record<string, string>): void {
  lastAgentTimestamp = t;
}

// ============================================================================
// IPC Message Tracking
// ============================================================================

const ipcMessageSentChats = new Set<string>();

export function getIpcMessageSentChats(): Set<string> {
  return ipcMessageSentChats;
}

// ============================================================================
// Typing Indicators (per chat) - with memory cap
// ============================================================================

const MAX_TYPING_ENTRIES = 100;
const typingIntervals = new Map<string, NodeJS.Timeout>();

export function getTypingIntervals(): Map<string, NodeJS.Timeout> {
  return typingIntervals;
}

/**
 * Set a typing interval for a chat, with an upper bound to prevent leaks.
 * If the map exceeds MAX_TYPING_ENTRIES, the oldest entry is evicted.
 */
export function setTypingInterval(
  chatId: string,
  interval: NodeJS.Timeout,
): void {
  // Evict oldest if at capacity
  if (
    typingIntervals.size >= MAX_TYPING_ENTRIES &&
    !typingIntervals.has(chatId)
  ) {
    const firstKey = typingIntervals.keys().next().value;
    if (firstKey !== undefined) {
      const old = typingIntervals.get(firstKey);
      if (old) clearInterval(old);
      typingIntervals.delete(firstKey);
    }
  }
  typingIntervals.set(chatId, interval);
}

export function clearTypingInterval(chatId: string): void {
  const interval = typingIntervals.get(chatId);
  if (interval) {
    clearInterval(interval);
    typingIntervals.delete(chatId);
  }
}
