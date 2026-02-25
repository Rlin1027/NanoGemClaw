import { Router } from 'express';
import { safeCompare } from '../utils/safe-compare.js';

interface AuthRouterDeps {
    accessCode: string | undefined;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
    const router = Router();
    const { accessCode } = deps;

    // POST /api/auth/verify
    router.post('/auth/verify', (req, res) => {
        const { accessCode: bodyCode } = req.body;
        // Check header first (from LoginScreen), then body
        const code = req.headers['x-access-code'] || bodyCode;

        if (accessCode && !safeCompare(String(code || ''), accessCode)) {
            res.status(401).json({ error: 'Invalid access code' });
            return;
        }
        res.json({ data: { success: true } });
    });

    return router;
}
