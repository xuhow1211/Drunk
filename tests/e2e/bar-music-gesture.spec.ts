/**
 * 自動播放被瀏覽器政策擋下時的情境測試。
 *
 * 驗證方式：以 addInitScript 攔截 HTMLAudioElement.play()，
 * 模擬瀏覽器自動播放政策的行為：
 *   - 頁面尚無任何使用者操作（click／keydown）時，play() 一律以
 *     NotAllowedError 拒絕，程式應先出現「右下小喇叭鈕」。
 *   - 出現過使用者操作後，play() 以已決的 promise 模擬播放成功，
 *     程式應收合成一般面板。
 *
 * 新流程（UX 修正後）：
 *   1. 首次進站先把等待播放的提示收成右下小喇叭鈕（含微亮角標），
 *      不再直接顯示整張卡片；點擊介面其他地方不會誤啟動播放。
 *   2. 使用者點小喇叭鈕後才展開完整提示卡（開始播放／不要背景音）。
 *   3. 「不要背景音」改以 localStorage 持久，重整之後也不再出現。
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

  test('首次進站先出現右下小喇叭鈕，不出現整張提示卡與播放面板', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('bar-music-gesture-chip')).toBeVisible();
    // 未經使用者主動點開前，不占版面也不誤啟動
    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
  });

  test('點擊頁面其他地方不會開始播放（不再有全域點擊播放）', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('bar-music-gesture-chip')).toBeVisible();

    // 點擊頁面上與播放無關的位置（例如主標）——不應啟動播放
    await page.locator('h1').first().click();
    await page.waitForTimeout(1500);

    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
    // 小喇叭鈕仍在原地等使用者點
    await expect(page.getByTestId('bar-music-gesture-chip')).toBeVisible();
  });

  test('點小喇叭鈕後展開提示卡，點開始播放收起為一般面板', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('bar-music-gesture-chip').click();

    const start = page.getByTestId('bar-music-start');
    await expect(start).toBeVisible();
    await expect(page.getByRole('button', { name: '不要背景音' })).toBeVisible();

    await start.click();
    await expect(page.getByTestId('bar-music-panel')).toBeVisible();
    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
  });

  test('選擇不要背景音後面板完全消失，且以 localStorage 持久記住', async ({ page }) => {
    await page.goto('/');

    // 先點開小喇叭鈕才看得到「不要背景音」
    await page.getByTestId('bar-music-gesture-chip').click();
    await page.getByRole('button', { name: '不要背景音' }).click();

    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-gesture-chip')).toHaveCount(0);
    // 持久化：寫進 localStorage 而非 sessionStorage
    expect(
      await page.evaluate(() => window.localStorage.getItem('join-bar-music-dismissed')),
    ).toBe('1');
  });

  test('不要背景音後重新整理也不再出現', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('bar-music-gesture-chip').click();
    await page.getByRole('button', { name: '不要背景音' }).click();
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);

    await page.reload();

    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-gesture-chip')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-start')).toHaveCount(0);
  });
});
