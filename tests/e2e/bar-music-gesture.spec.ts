/**
 * 自動播放被瀏覽器政策擋下時的情境測試。
 *
 * 瀏覽器預設允許已經與頁面互動過的使用者自動播放，
 * 因此要驗證「需要使用者點一下」這條路徑，必須以較嚴格的
 * 自動播放政策啟動瀏覽器。
 *
 * launchOptions 無法寫在 test.describe 內（會強制切換 worker），
 * 所以這個檔案的 test.use 必須放在最上層。
 */
import { expect, test } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--autoplay-policy=user-gesture-required'],
  },
});

test.describe('自動播放被瀏覽器擋下時', () => {
  test('出現請使用者點一下開始播放的卡片', async ({ page }) => {
    await page.route('**/ice1.somafm.com/**', (route) => route.abort());
    await page.goto('/');

    const start = page.getByTestId('bar-music-start');
    await expect(start).toBeVisible();
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
  });

  test('點擊開始播放後收起為一般面板', async ({ page }) => {
    await page.route('**/ice1.somafm.com/**', (route) => route.abort());
    await page.goto('/');

    await page.getByTestId('bar-music-start').click();
    await expect(page.getByTestId('bar-music-panel')).toBeVisible();
  });

  test('選擇不要背景音後面板完全消失', async ({ page }) => {
    await page.route('**/ice1.somafm.com/**', (route) => route.abort());
    await page.goto('/');

    await page.getByRole('button', { name: '不要背景音' }).click();
    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
  });

  test('點擊頁面任何地方就會開始播放', async ({ page }) => {
    await page.route('**/ice1.somafm.com/**', (route) => route.abort());
    await page.goto('/');

    await expect(page.getByTestId('bar-music-start')).toBeVisible();

    // 點擊頁面上與播放無關的位置（例如主標）
    await page.locator('h1').first().click();

    await expect(page.getByTestId('bar-music-panel')).toBeVisible();
    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
  });

  test('選擇不要背景音後，點擊頁面任何地方都不會開始播放', async ({ page }) => {
    await page.route('**/ice1.somafm.com/**', (route) => route.abort());
    await page.goto('/');

    await page.getByRole('button', { name: '不要背景音' }).click();
    await page.locator('h1').first().click();
    await page.waitForTimeout(1500);

    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
  });
});
