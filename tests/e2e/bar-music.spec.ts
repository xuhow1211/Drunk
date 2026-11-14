/**
 * 酒吧背景音的情境測試。
 *
 * 為了讓測試不受外部網路影響，一律攔截電台串流的請求，
 * 模擬離線情境，驗證會降級為合成環境音。
 *
 * 自動播放政策設為「不需要使用者互動」，讓進站後直接進入一般面板；
 * 被政策擋下的情境由 bar-music-gesture.spec.ts 驗證。
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required'],
  },
});

/** 攔截所有電台串流請求，讓測試不依賴外部網路。 */
async function blockStreams(page: Page) {
  await page.route('**/ice1.somafm.com/**', (route) => route.abort());
}

/** 收集頁面未捕捉的例外，避免背景音的錯誤被靜默吞掉。 */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** 等待面板進入離線模式（串流不可用、已降級為合成環境音）。 */
async function waitForOfflinePanel(page: Page) {
  const panel = page.getByTestId('bar-music-panel');
  await expect(panel).toContainText('離線模式', { timeout: 20_000 });
  return panel;
}

/** 是否為手機視窗（單行圖示列的斷點，768px 以下）。 */
function isMobileViewport(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 768;
}

test.describe('酒吧背景音', () => {
  test('首頁右下角出現背景音面板並顯示頻道名稱', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');

    const panel = await waitForOfflinePanel(page);

    // 手機上面板不出現頻道名稱（空間留給圖示），改用 textContent 讀（含 sr-only）
    const channelName = ((await panel.locator('p').first().textContent()) ?? '').trim();
    expect(channelName.length).toBeGreaterThan(0);
  });

  test('串流連不上時降級為合成環境音，且背景工作不拋出例外', async ({ page }) => {
    const errors = collectPageErrors(page);
    await blockStreams(page);
    await page.goto('/');

    await waitForOfflinePanel(page);

    // 合成環境音的和弦每 6 秒換一次、刷鼓每 0.88 秒敲一記，
    // 等候一輪以上，確保背景工作真的跑起來且沒有未捕捉的例外。
    await page.waitForTimeout(8000);

    expect(errors).toEqual([]);
  });

  test('可以靜音與取消靜音', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');
    await waitForOfflinePanel(page);

    const mute = page.getByTestId('bar-music-mute');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
  });

  test('音量滑桿可以調整並反映在數值上（桌機以上限定）', async ({ page }) => {
    // 手機版面板收合成單行圖示列，不出現音量滑桿（調音量在桌機進行）
    test.skip(isMobileViewport(page), '手機版沒有音量滑桿');
    await blockStreams(page);
    await page.goto('/');
    await waitForOfflinePanel(page);

    const slider = page.getByTestId('bar-music-volume');
    await expect(slider).toHaveValue('30');
    await slider.fill('80');
    await expect(slider).toHaveValue('80');
  });

  test('手機版面板收合成單行圖示列，寬度不超過 40vw 且不出現音量滑桿', async ({ page }) => {
    test.skip(!isMobileViewport(page), '單行圖示列為行動版限定');

    await blockStreams(page);
    await page.goto('/');
    const panel = await waitForOfflinePanel(page);

    // 五顆圖示按鈕（播放／暫停、靜音、換台、關閉、收合）都在單行內可見
    for (const testId of ['bar-music-toggle', 'bar-music-mute', 'bar-music-shuffle', 'bar-music-close', 'bar-music-collapse']) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
    // 音量滑桿在手機完全不出現
    await expect(page.getByTestId('bar-music-volume')).toBeHidden();

    // 寬度上限 40vw、高度維持約 44px 級的緊湊單行
    const viewportWidth = page.viewportSize()!.width;
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(viewportWidth * 0.4 + 1);
    expect(box!.height).toBeLessThanOrEqual(64);
  });

  test('可以隨機換一個頻道', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');
    const panel = await waitForOfflinePanel(page);

    // 手機上面板不出現頻道名稱（空間留給圖示），改用 textContent 讀（含 sr-only）
    const before = ((await panel.locator('p').first().textContent()) ?? '').trim();

    await page.getByTestId('bar-music-shuffle').click();

    // 頻道名稱必須改變（清單內有 10 個頻道，排除目前這個後不可能抽到同一個）
    await expect(panel.locator('p').first()).not.toHaveText(before);
  });

  test('收合鈕把面板收成角落小鈕，點擊小鈕可再展開', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');
    await waitForOfflinePanel(page);

    await page.getByTestId('bar-music-collapse').click();
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
    await expect(page.getByTestId('bar-music-expand')).toBeVisible();

    // 小鈕必須真的停靠在畫面內右下角（防止 fixed 被 panel 的 position 蓋掉）
    const chipBox = await page.getByTestId('bar-music-expand').boundingBox();
    const viewport = page.viewportSize()!;
    expect(chipBox).not.toBeNull();
    expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(viewport.height);

    await page.getByTestId('bar-music-expand').click();
    await expect(page.getByTestId('bar-music-panel')).toBeVisible();
    await expect(page.getByTestId('bar-music-expand')).toHaveCount(0);
  });

  test('關閉後面板消失且重新整理不會再出現', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');
    await waitForOfflinePanel(page);

    await page.getByTestId('bar-music-close').click();
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('bar-music-panel')).toHaveCount(0);
  });

  test('播放與暫停可以切換', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');
    await waitForOfflinePanel(page);

    const toggle = page.getByTestId('bar-music-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});
