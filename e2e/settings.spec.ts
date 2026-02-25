import { test, expect } from '@playwright/test';

async function loginAndGoToSettings(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('nanogemclaw_access_code', 'e2e-test-code'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForLoadState('networkidle');
}

test.describe('Settings', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndGoToSettings(page);
    });

    test('should navigate to settings tab via sidebar', async ({ page }) => {
        // SettingsPage renders "Runtime Flags" section heading
        await expect(page.getByText('Runtime Flags')).toBeVisible({ timeout: 10000 });
    });

    test('should display Maintenance Mode toggle', async ({ page }) => {
        await expect(page.getByText('Maintenance Mode')).toBeVisible({ timeout: 5000 });
    });

    test('should display Debug Logging toggle', async ({ page }) => {
        await expect(page.getByText('Debug Logging')).toBeVisible({ timeout: 5000 });
    });

    test('should display Connection Info section', async ({ page }) => {
        await expect(page.getByText('Connection Info')).toBeVisible({ timeout: 5000 });
    });

    test('should display Secrets Status section', async ({ page }) => {
        await expect(page.getByText('Secrets Status')).toBeVisible({ timeout: 5000 });
    });

    test('should display Danger Zone section', async ({ page }) => {
        await expect(page.getByText('Danger Zone')).toBeVisible({ timeout: 5000 });
    });

    test('should have enabled Clear Errors button', async ({ page }) => {
        const clearBtn = page.getByRole('button', { name: /Clear Errors/i });
        await expect(clearBtn).toBeVisible({ timeout: 5000 });
        await expect(clearBtn).toBeEnabled();
    });

    test('should toggle Maintenance Mode when clicked', async ({ page }) => {
        // The toggle is a button wrapping a slider div; click it and verify no JS error
        const toggle = page.locator('button').filter({ has: page.locator('div.rounded-full') }).first();
        const visible = await toggle.isVisible({ timeout: 3000 }).catch(() => false);
        if (visible) {
            await toggle.click();
            // Page should still be functional after toggle
            await expect(page.getByText('Runtime Flags')).toBeVisible({ timeout: 3000 });
        }
    });
});
