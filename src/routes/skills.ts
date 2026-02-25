import { Router } from 'express';
import path from 'path';
import { GROUPS_DIR } from '../config.js';
import { validate } from '../middleware/validate.js';
import { skillsFolderParams, skillsUpdateBody } from '../schemas/skills.js';

export function createSkillsRouter(): Router {
  const router = Router();

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
  router.get(
    '/groups/:folder/skills',
    validate({ params: skillsFolderParams }),
    async (req, res) => {
      const folder = req.params.folder as string;
      try {
        const { getGroupSkills } = await import('../skills.js');
        const skillIds = getGroupSkills(folder);
        res.json({ data: skillIds });
      } catch {
        res.status(500).json({ error: 'Failed to fetch group skills' });
      }
    },
  );

  // POST /api/groups/:folder/skills
  router.post(
    '/groups/:folder/skills',
    validate({ params: skillsFolderParams, body: skillsUpdateBody }),
    async (req, res) => {
      const folder = req.params.folder as string;
      const { skillId, enabled } = req.body;
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
    },
  );

  return router;
}
