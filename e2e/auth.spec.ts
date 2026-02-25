import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.removeItem('nanogemclaw_access_code'));
    });

    test('should show login screen when not authenticated', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByPlaceholder('Enter Access Code')).toBeVisible({ timeout: 10000 });
    });

    test('should login with valid access code', async ({ page }) => {
        await page.goto('/');
        await page.getByPlaceholder('Enter Access Code').fill('e2e-test-code');
        await page.getByRole('button', { name: /Access Dashboard/i }).click();

        // Should navigate away from login — dashboard header becomes visible
        await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });
    });

    test('should reject invalid access code', async ({ page }) => {
        await page.goto('/');
        await page.getByPlaceholder('Enter Access Code').fill('wrong-code');
        await page.getByRole('button', { name: /Access Dashboard/i }).click();

        await expect(page.getByText('Invalid access code')).toBeVisible({ timeout: 5000 });
    });

    test('should persist login across page reload', async ({ page }) => {
        await page.goto('/');
        await page.getByPlaceholder('Enter Access Code').fill('e2e-test-code');
        await page.getByRole('button', { name: /Access Dashboard/i }).click();
        await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

        await page.reload();

        // Stored code in localStorage should keep user authenticated
        await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });
    });
});
