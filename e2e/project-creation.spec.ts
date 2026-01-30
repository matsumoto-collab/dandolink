
import { test, expect } from '@playwright/test';

test.describe('Project Creation Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Mock authenticated session
        await page.route('/api/auth/session', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    user: {
                        id: 'test-user-id',
                        name: 'Test User',
                        email: 'test@example.com',
                        role: 'manager',
                        isActive: true,
                    },
                    expires: '2099-01-01T00:00:00.000Z',
                }),
            });
        });
    });

    test('should create a new project from calendar cell', async ({ page }) => {
        // Go to calendar page (root)
        await page.goto('/');

        // Wait for calendar to load
        // We expect "今週" button or similar to confirm page loaded, or just wait for cells
        await expect(page.getByRole('button', { name: '今週' })).toBeVisible({ timeout: 10000 });

        // Find and click an empty calendar cell (first one)
        // We added data-testid="calendar-cell"
        const firstCell = page.getByTestId('calendar-cell').first();
        await expect(firstCell).toBeVisible();
        await firstCell.click();

        // Select "新規作成" from the selection modal
        await page.getByRole('button', { name: '新規作成' }).click();

        // Fill project form
        const testTitle = `E2E Test Project ${Date.now()}`;
        await page.getByLabel('現場名').fill(testTitle);

        // Select Construction Type "組立"
        // Using label text to find checkbox
        await page.getByText('組立', { exact: true }).click();

        // Fill Customer (optional but good to test)
        await page.getByPlaceholder('顧客を検索または入力...').fill('Test Customer');

        // Save
        await page.getByRole('button', { name: '保存' }).click();

        // Verify
        // The modal should close and the new event should appear
        // We can look for the text of the project title
        await expect(page.getByText(testTitle)).toBeVisible({ timeout: 10000 });
    });
});
