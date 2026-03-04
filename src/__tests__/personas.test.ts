import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import {
  PERSONAS,
  PERSONA_CATEGORIES,
  PERSONA_TEMPLATES,
  getAllPersonas,
  saveCustomPersona,
  deleteCustomPersona,
  loadCustomPersonas,
  getEffectiveSystemPrompt,
} from '../personas.js';

describe('personas', () => {
  beforeEach(() => {
    // Reset custom personas by reloading with empty file
    loadCustomPersonas();
  });

  describe('PERSONA_TEMPLATES', () => {
    it('has exactly 15 built-in personas', () => {
      expect(Object.keys(PERSONA_TEMPLATES)).toHaveLength(15);
    });

    it('includes all required persona keys', () => {
      const expectedKeys = [
        'default',
        'coder',
        'translator',
        'writer',
        'analyst',
        'secretary',
        'tracker',
        'tutor',
        'study-buddy',
        'finance',
        'fitness',
        'chef',
        'travel',
        'copywriter',
        'devops',
      ];
      for (const key of expectedKeys) {
        expect(PERSONA_TEMPLATES).toHaveProperty(key);
      }
    });

    it('all persona system prompts are at least 150 characters', () => {
      for (const [key, persona] of Object.entries(PERSONA_TEMPLATES)) {
        expect(
          persona.systemPrompt.length,
          `Persona "${key}" systemPrompt is too short (${persona.systemPrompt.length} chars)`,
        ).toBeGreaterThanOrEqual(150);
      }
    });

    it('all persona system prompts are at most 400 characters', () => {
      for (const [key, persona] of Object.entries(PERSONA_TEMPLATES)) {
        expect(
          persona.systemPrompt.length,
          `Persona "${key}" systemPrompt is too long (${persona.systemPrompt.length} chars)`,
        ).toBeLessThanOrEqual(400);
      }
    });

    it('all personas have a category set', () => {
      for (const [key, persona] of Object.entries(PERSONA_TEMPLATES)) {
        expect(
          persona.category,
          `Persona "${key}" is missing a category`,
        ).toBeDefined();
        expect(PERSONA_CATEGORIES).toContain(persona.category);
      }
    });

    it('all personas have non-empty name and description', () => {
      for (const [key, persona] of Object.entries(PERSONA_TEMPLATES)) {
        expect(
          persona.name.length,
          `Persona "${key}" name is empty`,
        ).toBeGreaterThan(0);
        expect(
          persona.description.length,
          `Persona "${key}" description is empty`,
        ).toBeGreaterThan(0);
      }
    });
  });

  describe('PERSONA_CATEGORIES', () => {
    it('contains expected categories', () => {
      expect(PERSONA_CATEGORIES).toContain('general');
      expect(PERSONA_CATEGORIES).toContain('technical');
      expect(PERSONA_CATEGORIES).toContain('productivity');
      expect(PERSONA_CATEGORIES).toContain('creative');
      expect(PERSONA_CATEGORIES).toContain('learning');
      expect(PERSONA_CATEGORIES).toContain('finance');
      expect(PERSONA_CATEGORIES).toContain('lifestyle');
    });
  });

  describe('PERSONAS', () => {
    it('is identical to PERSONA_TEMPLATES', () => {
      expect(PERSONAS).toBe(PERSONA_TEMPLATES);
    });
  });

  describe('getAllPersonas()', () => {
    it('returns all built-in personas when no custom personas exist', () => {
      const all = getAllPersonas();
      expect(Object.keys(all)).toHaveLength(15);
    });

    it('merges custom personas with built-ins', () => {
      saveCustomPersona('my-custom', {
        name: 'My Custom',
        description: 'A custom persona',
        systemPrompt: 'You are a custom assistant.',
      });
      const all = getAllPersonas();
      expect(all).toHaveProperty('my-custom');
      expect(Object.keys(all).length).toBeGreaterThan(15);
    });

    it('custom personas do not override built-ins', () => {
      const all = getAllPersonas();
      expect(all['default'].name).toBe('General Assistant');
    });
  });

  describe('saveCustomPersona()', () => {
    it('saves a new custom persona', () => {
      saveCustomPersona('test-persona', {
        name: 'Test',
        description: 'A test',
        systemPrompt: 'You are a test assistant.',
      });
      expect(getAllPersonas()).toHaveProperty('test-persona');
    });

    it('throws when attempting to override a built-in persona', () => {
      expect(() =>
        saveCustomPersona('default', {
          name: 'Override',
          description: 'Attempt override',
          systemPrompt: 'You are not allowed.',
        }),
      ).toThrow(/built-in/i);
    });

    it('saves persona with optional category', () => {
      saveCustomPersona('categorized', {
        name: 'Categorized',
        description: 'Has a category',
        systemPrompt: 'You are categorized.',
        category: 'general',
      });
      const all = getAllPersonas();
      expect(all['categorized'].category).toBe('general');
    });
  });

  describe('deleteCustomPersona()', () => {
    it('deletes an existing custom persona', () => {
      saveCustomPersona('to-delete', {
        name: 'Delete Me',
        description: 'Will be deleted',
        systemPrompt: 'You are temporary.',
      });
      const result = deleteCustomPersona('to-delete');
      expect(result).toBe(true);
      expect(getAllPersonas()).not.toHaveProperty('to-delete');
    });

    it('returns false when persona does not exist', () => {
      const result = deleteCustomPersona('nonexistent');
      expect(result).toBe(false);
    });

    it('throws when attempting to delete a built-in persona', () => {
      expect(() => deleteCustomPersona('coder')).toThrow(/built-in/i);
    });
  });

  describe('getEffectiveSystemPrompt()', () => {
    it('returns group custom prompt when provided', () => {
      const result = getEffectiveSystemPrompt('Custom prompt text', 'coder');
      expect(result).toBe('Custom prompt text');
    });

    it('returns persona system prompt when no custom prompt', () => {
      const result = getEffectiveSystemPrompt(undefined, 'coder');
      expect(result).toBe(PERSONA_TEMPLATES['coder'].systemPrompt);
    });

    it('returns default persona prompt when no args', () => {
      const result = getEffectiveSystemPrompt();
      expect(result).toBe(PERSONA_TEMPLATES['default'].systemPrompt);
    });

    it('returns default persona prompt for unknown persona key', () => {
      const result = getEffectiveSystemPrompt(undefined, 'nonexistent-key');
      expect(result).toBe(PERSONA_TEMPLATES['default'].systemPrompt);
    });

    it('priority: custom prompt > persona > default', () => {
      const custom = 'Override';
      expect(getEffectiveSystemPrompt(custom, 'coder')).toBe(custom);
      expect(getEffectiveSystemPrompt(undefined, 'coder')).toBe(
        PERSONA_TEMPLATES['coder'].systemPrompt,
      );
      expect(getEffectiveSystemPrompt()).toBe(
        PERSONA_TEMPLATES['default'].systemPrompt,
      );
    });
  });
});
