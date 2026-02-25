import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: [
        {
            command: 'npm run dev',
            port: 3000,
            reuseExistingServer: !process.env.CI,
            env: {
                DASHBOARD_ACCESS_CODE: 'e2e-test-code',
                TELEGRAM_BOT_TOKEN: 'fake-token-for-e2e',
                NODE_ENV: 'test',
            },
        },
        {
            command: 'npm run dev',
            port: 5173,
            cwd: 'packages/dashboard',
            reuseExistingServer: !process.env.CI,
        },
    ],
});
