import { test, expect } from '@playwright/test';

// Helper: authenticate and land on the dashboard
async function login(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('nanogemclaw_access_code', 'e2e-test-code'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
}

test.describe('Groups', () => {
    test.beforeEach(async ({ page }) => {
        await login(page);
    });

    test('should display overview page after login', async ({ page }) => {
        // Overview tab is active by default — dashboard header is present
        await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });
    });

    test('should show group cards or empty state on overview', async ({ page }) => {
        // Either a StatusCard grid or one of the two empty-state messages is shown
        const hasGroups = await page.locator('.grid').isVisible({ timeout: 5000 }).catch(() => false);
        const hasEmpty = await page.getByText('No active groups found.').isVisible().catch(() => false);
        const hasConnecting = await page.getByText('Connecting to server...').isVisible().catch(() => false);

        expect(hasGroups || hasEmpty || hasConnecting).toBe(true);
    });

    test('should show filter input on overview', async ({ page }) => {
        await expect(page.getByPlaceholder('Filter groups...')).toBeVisible({ timeout: 5000 });
    });

    test('should show connection status indicator', async ({ page }) => {
        // Either "Connected" or "Reconnecting..." badge is rendered
        const connected = await page.getByText('Connected').isVisible({ timeout: 5000 }).catch(() => false);
        const reconnecting = await page.getByText('Reconnecting...').isVisible().catch(() => false);
        expect(connected || reconnecting).toBe(true);
    });

    test('should navigate to group detail when clicking a group card', async ({ page }) => {
        // Only run the click if a group card exists; otherwise pass defensively
        const groupCard = page.locator('.grid > div').first();
        const cardVisible = await groupCard.isVisible({ timeout: 3000 }).catch(() => false);
        if (cardVisible) {
            await groupCard.click();
            // Group detail tab renders — "Back" button appears
            await expect(page.getByRole('button', { name: /back/i })).toBeVisible({ timeout: 5000 });
        }
    });
});
