import { Router } from 'express';
import path from 'path';
import { GROUPS_DIR } from '../config.js';

interface SkillsRouterDeps {
  validateFolder: (folder: string) => boolean;
}

export function createSkillsRouter(deps: SkillsRouterDeps): Router {
  const router = Router();
  const { validateFolder } = deps;

  // GET /api/skills
  router.get('/skills', async (_req, res) => {
    try {
      const { scanAvailableSkills } = await import('../skills.js');
      const skillsDir = path.join(GROUPS_DIR, '..', 'container', 'skills');
      const skills = scanAvailableSkills(skillsDir);
      res.json({ data: skills });
    } catch {
      res.status(500).json({ error: 'Failed to fetch skills' });
    }
  });

  // GET /api/groups/:folder/skills
  router.get('/groups/:folder/skills', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }
    try {
      const { getGroupSkills } = await import('../skills.js');
      const skillIds = getGroupSkills(folder);
      res.json({ data: skillIds });
    } catch {
      res.status(500).json({ error: 'Failed to fetch group skills' });
    }
  });

  // POST /api/groups/:folder/skills
  router.post('/groups/:folder/skills', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }
    const { skillId, enabled } = req.body;
    if (
      !skillId ||
      typeof skillId !== 'string' ||
      typeof enabled !== 'boolean'
    ) {
      res.status(400).json({
        error:
          'Missing or invalid fields: skillId (string) and enabled (boolean) required',
      });
      return;
    }
    try {
      const { enableGroupSkill, disableGroupSkill } =
        await import('../skills.js');
      if (enabled) {
        enableGroupSkill(folder, skillId);
      } else {
        disableGroupSkill(folder, skillId);
      }
      res.json({ data: { success: true } });
    } catch {
      res.status(500).json({ error: 'Failed to update skill' });
    }
  });

  return router;
}
