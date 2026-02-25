/**
 * Agent Persona Definitions
 *
 * Provides pre-defined system prompts for different agent personalities.
 */

import fs from 'fs';
import path from 'path';

export interface Persona {
  name: string;
  description: string;
  systemPrompt: string;
}

export const PERSONAS: Record<string, Persona> = {
  default: {
    name: 'General Assistant',
    description: 'Helpful and concise assistant (Default)',
    systemPrompt:
      'You are a helpful AI assistant. Answer concisely and accurately.',
  },
  coder: {
    name: 'Software Engineer',
    description: 'Expert developer, focuses on code quality and patterns',
    systemPrompt:
      'You are an expert software engineer. Focus on clean code, best practices, and efficient algorithms. Provide code blocks for solutions.',
  },
  translator: {
    name: 'Translator',
    description: 'Professional translator (EN/ZH)',
    systemPrompt:
      'You are a professional translator. Translate user input between English and Traditional Chinese (Taiwan). maintain nuance and tone.',
  },
  writer: {
    name: 'Creative Writer',
    description: 'Creative writing aide for blogs and stories',
    systemPrompt:
      'You are a creative writer. Help draft engaging content, refine tone, and improve clarity. Use evocative language.',
  },
  analyst: {
    name: 'Data Analyst',
    description: 'Logical thinker, breaks down complex problems',
    systemPrompt:
      'You are a data analyst. Approach problems logically. Break down complex issues into smaller steps. Focus on facts and data.',
  },
};

const CUSTOM_PERSONAS_FILE = path.join(
  process.cwd(),
  'data',
  'custom_personas.json',
);

let customPersonas: Record<string, Persona> = {};

/**
 * Load custom personas from disk. Called at startup.
 */
export function loadCustomPersonas(): void {
  try {
    if (fs.existsSync(CUSTOM_PERSONAS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CUSTOM_PERSONAS_FILE, 'utf-8'));
      customPersonas = data;
    }
  } catch {
    customPersonas = {};
  }
}

function saveCustomPersonas(): void {
  const dir = path.dirname(CUSTOM_PERSONAS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    CUSTOM_PERSONAS_FILE,
    JSON.stringify(customPersonas, null, 2),
  );
}

/**
 * Get all personas (built-in + custom).
 */
export function getAllPersonas(): Record<string, Persona> {
  return { ...PERSONAS, ...customPersonas };
}

/**
 * Create or update a custom persona.
 */
export function saveCustomPersona(key: string, persona: Persona): void {
  if (PERSONAS[key]) {
    throw new Error(`Cannot override built-in persona: ${key}`);
  }
  customPersonas[key] = persona;
  saveCustomPersonas();
}

/**
 * Delete a custom persona.
 */
export function deleteCustomPersona(key: string): boolean {
  if (PERSONAS[key]) {
    throw new Error(`Cannot delete built-in persona: ${key}`);
  }
  if (!customPersonas[key]) return false;
  delete customPersonas[key];
  saveCustomPersonas();
  return true;
}

/**
 * Get the effective system prompt for a group
 * Priority: Group Custom Prompt > Persona Prompt > Default Prompt
 */
export function getEffectiveSystemPrompt(
  groupCustomPrompt?: string,
  personaKey?: string,
): string {
  if (groupCustomPrompt) {
    return groupCustomPrompt;
  }

  const allPersonas = getAllPersonas();
  if (personaKey && allPersonas[personaKey]) {
    return allPersonas[personaKey].systemPrompt;
  }

  return PERSONAS.default.systemPrompt;
}
