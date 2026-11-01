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
  await page.route('**/*.mp3', (route) => route.abort());
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

test.describe('酒吧背景音', () => {
  test('首頁右下角出現背景音面板並顯示頻道名稱', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');

    const panel = await waitForOfflinePanel(page);

    const channelName = (await panel.locator('p').first().innerText()).trim();
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

  test('音量滑桿可以調整並反映在數值上', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');
    await waitForOfflinePanel(page);

    const slider = page.getByTestId('bar-music-volume');
    await expect(slider).toHaveValue('30');
    await slider.fill('80');
    await expect(slider).toHaveValue('80');
  });

  test('可以隨機換一個頻道', async ({ page }) => {
    await blockStreams(page);
    await page.goto('/');
    const panel = await waitForOfflinePanel(page);

    const before = (await panel.locator('p').first().innerText()).trim();

    await page.getByTestId('bar-music-shuffle').click();

    // 頻道名稱必須改變（清單內有 10 個頻道，排除目前這個後不可能抽到同一個）
    await expect(panel.locator('p').first()).not.toHaveText(before);
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
