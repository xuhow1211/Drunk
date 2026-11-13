/**
 * 自動播放被瀏覽器政策擋下時的情境測試。
 *
 * 驗證方式：以 addInitScript 攔截 HTMLAudioElement.play()，
 * 模擬瀏覽器自動播放政策的行為：
 *   - 頁面尚無任何使用者操作（click／keydown）時，play() 一律以
 *     NotAllowedError 拒絕，程式應顯示「等待播放」卡片。
 *   - 出現過使用者操作後，play() 以已決的 promise 模擬播放成功，
 *     程式應收合成一般面板。
 *
 * 不依賴瀏覽器旗標或 navigator.userActivation：實測在測試 runner
 * 的環境下，頁面載入當下 userActivation 即為 active，且 Chrome
 * 會因靜音／媒體狀態改變錯誤型別，任何依賴真實播放錯誤的作法
 * 都會隨網路與參數浮動，這也是這組測試過去偶發失敗的原因。
 * 同時避免讓瀏覽器真的去載入電台串流，情境完全確定。
 */
import { expect, test } from '@playwright/test';

test.describe('自動播放被瀏覽器擋下時', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      let userActed = false;
      const markUserActed = () => {
        userActed = true;
      };
      document.addEventListener('click', markUserActed, true);
      document.addEventListener('keydown', markUserActed, true);
      HTMLAudioElement.prototype.play = function () {
        if (!userActed) {
          return Promise.reject(
            new DOMException('模擬自動播放政策：需要使用者手勢。', 'NotAllowedError'),
          );
        }
        return Promise.resolve();
      };
    });
  });

  test('出現請使用者點一下開始播放的卡片', async ({ page }) => {
    await page.goto('/');

    const start = page.getByTestId('bar-music-start');
    await expect(start).toBeVisible();
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
  });

  test('點擊開始播放後收起為一般面板', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('bar-music-start').click();
    await expect(page.getByTestId('bar-music-panel')).toBeVisible();
  });

  test('選擇不要背景音後面板完全消失', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: '不要背景音' }).click();
    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
  });

  test('點擊頁面任何地方就會開始播放', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('bar-music-start')).toBeVisible();

    // 點擊頁面上與播放無關的位置（例如主標）
    await page.locator('h1').first().click();

    await expect(page.getByTestId('bar-music-panel')).toBeVisible();
    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
  });

  test('選擇不要背景音後，點擊頁面任何地方都不會開始播放', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: '不要背景音' }).click();
    await page.locator('h1').first().click();
    await page.waitForTimeout(1500);

    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
  });
});
