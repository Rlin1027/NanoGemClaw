import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { loadJson, saveJson } from './utils.js';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  type: 'file' | 'directory';
}

interface GroupSkillsData {
  [groupFolder: string]: string[];
}

const GROUP_SKILLS_FILE = path.join(DATA_DIR, 'group_skills.json');

/**
 * Parse YAML frontmatter from a markdown file.
 * Extracts name and description fields.
 */
function parseFrontmatter(content: string): { name: string; description: string } | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const yaml = frontmatterMatch[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*(.+)$/m);

  if (!nameMatch || !descMatch) return null;

  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
  };
}

/**
 * Scan container/skills/ directory and return all available skills.
 */
export function scanAvailableSkills(skillsDir: string): SkillInfo[] {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const skills: SkillInfo[] = [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(skillsDir, entry.name);

    if (entry.isFile() && entry.name.endsWith('.md')) {
      // Top-level skill file
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        if (frontmatter) {
          const id = path.basename(entry.name, '.md');
          skills.push({
            id,
            name: frontmatter.name,
            description: frontmatter.description,
            path: entry.name,
            type: 'file',
          });
        }
      } catch (err) {
        console.warn(`[skills] Failed to parse ${entry.name}:`, err instanceof Error ? err.message : String(err));
      }
    } else if (entry.isDirectory()) {
      // Directory-based skill
      const skillMdPath = path.join(fullPath, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const frontmatter = parseFrontmatter(content);
          if (frontmatter) {
            skills.push({
              id: entry.name,
              name: frontmatter.name,
              description: frontmatter.description,
              path: path.join(entry.name, 'SKILL.md'),
              type: 'directory',
            });
          }
        } catch (err) {
          console.warn(`[skills] Failed to parse ${entry.name}/SKILL.md:`, err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  return skills;
}

/**
 * Get skills enabled for a specific group.
 * Returns all skill IDs if no entry exists (default: all enabled).
 */
export function getGroupSkills(groupFolder: string): string[] {
  const data = loadJson<GroupSkillsData>(GROUP_SKILLS_FILE, {});
  return data[groupFolder] || [];
}

/**
 * Enable a skill for a group.
 */
export function enableGroupSkill(groupFolder: string, skillId: string): void {
  const data = loadJson<GroupSkillsData>(GROUP_SKILLS_FILE, {});
  if (!data[groupFolder]) {
    data[groupFolder] = [];
  }
  if (!data[groupFolder].includes(skillId)) {
    data[groupFolder].push(skillId);
    saveJson(GROUP_SKILLS_FILE, data);
  }
}

/**
 * Disable a skill for a group.
 */
export function disableGroupSkill(groupFolder: string, skillId: string): void {
  const data = loadJson<GroupSkillsData>(GROUP_SKILLS_FILE, {});
  if (data[groupFolder]) {
    data[groupFolder] = data[groupFolder].filter(id => id !== skillId);
    saveJson(GROUP_SKILLS_FILE, data);
  }
}

/**
 * Get the content of enabled skills for context injection.
 * Returns concatenated skill file contents, separated by dividers.
 */
export function getEnabledSkillContents(skillsDir: string, groupFolder: string): string {
  const allSkills = scanAvailableSkills(skillsDir);
  const enabledIds = getGroupSkills(groupFolder);

  // Default: all skills enabled if no entry exists
  const effectiveIds = enabledIds.length > 0
    ? enabledIds
    : allSkills.map(s => s.id);

  const contents: string[] = [];

  for (const skillId of effectiveIds) {
    const skill = allSkills.find(s => s.id === skillId);
    if (!skill) continue;

    const skillPath = path.join(skillsDir, skill.path);
    try {
      const content = fs.readFileSync(skillPath, 'utf-8');
      contents.push(content);
    } catch (err) {
      console.warn(`[skills] Failed to read ${skill.path}:`, err instanceof Error ? err.message : String(err));
    }
  }

  return contents.join('\n\n---\n\n');
}
