
import { test, expect } from '@playwright/test';

test.describe('Assignment Dispatch Flow', () => {
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

        // Mock Assignments GET
        // We return one assignment located at today's date for a test employee
        // Using a fixed date or relative to today is tricky in E2E.
        // We will assume the calendar loads the current week.
        // We'll create an assignment for TODAY.
        const today = new Date();
        today.setHours(9, 0, 0, 0); // 9:00 AM

        const mockAssignment = {
            id: 'assign-1',
            projectMasterId: 'pm-1',
            projectMaster: {
                id: 'pm-1',
                title: 'Test Dispatch Project',
                customerName: 'Test Customer',
                constructionType: 'assembly',
            },
            assignedEmployeeId: 'unassigned', // Placing in unassigned row or similar? 
            // Actually, let's put it on an employee row if possible, or assume EmployeeRowComponent handles unassigned?
            // Let's use 'emp-1' and assume mockEmployees exists or we rely on empty row logic?
            // Better: The test environment might not have employees loaded if we don't mock /api/users or similar?
            // But `useMasterData` loads things.
            // Let's assume there is at least one row.
            // Or we use 'unassigned' if it renders in a visible area (usually visible).

            // Wait, if we rely on real backend for employees, we might have rows.
            // Let's use a date string for today.
            date: today.toISOString(),
            workers: [],
            vehicles: [],
            sortOrder: 0,
            isDispatchConfirmed: false,
        };

        await page.route('/api/assignments*', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([mockAssignment]),
                });
            } else if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
                // Mock the update
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ ...mockAssignment, isDispatchConfirmed: true }),
                });
            } else {
                await route.continue();
            }
        });
    });

    test('should dispatch an assignment', async ({ page }) => {
        await page.goto('/');

        // Locate the event card
        const card = page.getByText('Test Dispatch Project');
        await expect(card).toBeVisible({ timeout: 10000 });

        // Find the dispatch button (clipboard chart icon? title="手配確定")
        // The button is inside the card.
        // Accessing the button relative to the card text might need locator chaining or filtering.
        // Or just page.getByTitle("手配確定").
        const dispatchBtn = page.getByTitle('手配確定').first();
        await dispatchBtn.click();

        // Verify Modal appears
        await expect(page.getByText('手配を確定しますか？')).toBeVisible(); // Assuming modal text
        // Click Confirm
        await page.getByRole('button', { name: /確定|OK|Yes/ }).click();

        // Verify button state changes (icon changes to CheckCircle or title changes)
        await expect(page.getByTitle('手配確定済み')).toBeVisible({ timeout: 5000 });
    });
});
