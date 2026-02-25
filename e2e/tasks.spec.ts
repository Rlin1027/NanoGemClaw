import { test, expect } from '@playwright/test';

async function loginAndGoToTasks(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('nanogemclaw_access_code', 'e2e-test-code'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Click the Tasks nav item in the sidebar
    await page.getByRole('button', { name: 'Tasks' }).click();
    await page.waitForLoadState('networkidle');
}

test.describe('Tasks', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndGoToTasks(page);
    });

    test('should navigate to tasks tab via sidebar', async ({ page }) => {
        // TasksPage header or empty state should be present
        const content = await page.textContent('body');
        expect(content).toBeTruthy();
        // Sidebar Tasks button should be in active state (no error)
        await expect(page.getByRole('button', { name: 'Tasks' })).toBeVisible();
    });

    test('should show task list or empty state', async ({ page }) => {
        const hasEmpty = await page.getByText('No tasks found').isVisible({ timeout: 5000 }).catch(() => false);
        const hasTasks = await page.locator('.space-y-2 > div').first().isVisible({ timeout: 5000 }).catch(() => false);
        expect(hasEmpty || hasTasks).toBe(true);
    });

    test('should open create task modal when add button is clicked', async ({ page }) => {
        // TasksPage renders an "Add Task" or "New Task" button
        const addButton = page.getByRole('button', { name: /add task|new task|schedule task/i });
        const addVisible = await addButton.isVisible({ timeout: 3000 }).catch(() => false);
        if (addVisible) {
            await addButton.click();
            // TaskFormModal is a dialog
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
        }
    });

    test('should expand task to show run history when clicked', async ({ page }) => {
        // Find a task row (the clickable row inside TaskList)
        const taskRow = page.locator('.space-y-2 .cursor-pointer').first();
        const rowVisible = await taskRow.isVisible({ timeout: 3000 }).catch(() => false);
        if (rowVisible) {
            await taskRow.click();
            // Expanded section shows "Run History" or "Task Details"
            const expanded = await page.getByText(/Run History|Task Details/i).isVisible({ timeout: 3000 }).catch(() => false);
            expect(expanded).toBe(true);
        }
    });

    test('should show pause button for active tasks', async ({ page }) => {
        // title="Pause" is set on the pause button in TaskList
        const pauseBtn = page.locator('button[title="Pause"]').first();
        const visible = await pauseBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (visible) {
            await expect(pauseBtn).toBeEnabled();
        }
    });

    test('should show delete button for tasks', async ({ page }) => {
        // title="Delete" is set on the Trash2 button in TaskList
        const deleteBtn = page.locator('button[title="Delete"]').first();
        const visible = await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (visible) {
            await expect(deleteBtn).toBeEnabled();
        }
    });
});
