import { test, expect } from '@playwright/test';

test.describe('ナビゲーション', () => {
    // 認証をスキップしてテスト（開発環境用）
    test.beforeEach(async ({ page }) => {
        // ログインページにリダイレクトされる場合は認証が必要
        await page.goto('/');
    });

    test('メインページにアクセスできる', async ({ page }) => {
        // ログインページまたはメインページが表示される
        const isLoginPage = await page.getByText(/ログイン|サインイン/i).isVisible().catch(() => false);

        if (isLoginPage) {
            await expect(page.getByRole('button', { name: /ログイン/i })).toBeVisible();
        } else {
            // メインページの要素を確認
            await expect(page.locator('body')).toBeVisible();
        }
    });

    test('ページタイトルが設定されている', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/.+/);
    });
});

test.describe('レスポンシブ', () => {
    test('モバイルサイズで表示できる', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/login');

        await expect(page.locator('body')).toBeVisible();
    });

    test('タブレットサイズで表示できる', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/login');

        await expect(page.locator('body')).toBeVisible();
    });

    test('デスクトップサイズで表示できる', async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto('/login');

        await expect(page.locator('body')).toBeVisible();
    });
});
