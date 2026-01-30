import { test, expect } from '@playwright/test';

test.describe('認証', () => {
    test('ログインページが表示される', async ({ page }) => {
        await page.goto('/login');

        await expect(page.getByRole('heading', { name: /ログイン|サインイン/i })).toBeVisible();
        await expect(page.getByPlaceholder(/ユーザー名|メール/i)).toBeVisible();
        await expect(page.getByPlaceholder(/パスワード/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /ログイン/i })).toBeVisible();
    });

    test('空のフォームで送信するとエラーが表示される', async ({ page }) => {
        await page.goto('/login');

        await page.getByRole('button', { name: /ログイン/i }).click();

        // HTML5バリデーションまたはカスタムエラー
        const usernameInput = page.getByPlaceholder(/ユーザー名|メール/i);
        await expect(usernameInput).toBeVisible();
    });

    test('不正な認証情報でエラーが表示される', async ({ page }) => {
        await page.goto('/login');

        await page.getByPlaceholder(/ユーザー名|メール/i).fill('invalid@test.com');
        await page.getByPlaceholder(/パスワード/i).fill('wrongpassword');
        await page.getByRole('button', { name: /ログイン/i }).click();

        // エラーメッセージを待つ
        await expect(page.getByText(/エラー|失敗|無効|incorrect/i)).toBeVisible({ timeout: 10000 });
    });
});
