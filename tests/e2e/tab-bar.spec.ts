/**
 * 手機版底部導覽列（下方導覽）情境測試。
 *
 * 同一組測試在 desktop-1440 與 mobile-375 兩個專案下各跑一次：
 *   - 768px 以下：下方導覽可見，目前頁面以 aria-current="page" 標示，
 *     點擊 tab 切換頁面；上導覽不再出現連結列（只剩品牌與會員區）。
 *   - 768px 以上：下方導覽不渲染，頂部導覽維持完整連結列。
 */
import { expect, test, type Page } from '@playwright/test';

/** 是否為手機視窗（下方導覽的斷點，768px 以下）。 */
function isMobileViewport(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 768;
}

/** 下方導覽列。 */
function tabBar(page: Page) {
  return page.getByRole('navigation', { name: '下方導覽' });
}

test.describe('手機底部導覽', () => {
  test('下方導覽的出現與隱藏依視窗寬度切換，四個入口齊全', async ({ page }) => {
    if (!isMobileViewport(page)) {
      // 桌機：tab bar 不渲染，頂部導覽的連結列維持原狀
      await page.goto('/');
      await expect(tabBar(page)).toHaveCount(0);
      await expect(
        page.getByRole('navigation', { name: '上導覽' }).getByRole('link', { name: '經典調酒' }),
      ).toBeVisible();
      return;
    }

    await page.goto('/');
    await expect(tabBar(page)).toBeVisible();
    for (const name of ['首頁', '經典調酒', '熱門推薦', '手邊有什麼']) {
      await expect(tabBar(page).getByRole('link', { name })).toBeVisible();
    }
    // 目前頁面（首頁）的 tab 帶 aria-current="page"，其餘 tab 不得帶
    await expect(tabBar(page).getByRole('link', { name: '首頁' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of ['經典調酒', '熱門推薦', '手邊有什麼']) {
      await expect(tabBar(page).getByRole('link', { name })).not.toHaveAttribute('aria-current', /.*/);
    }
    // 上導覽仍在（品牌＋會員區），但其上沒有任何入口連結（連結列隱藏）
    await expect(
      page.getByRole('navigation', { name: '上導覽' }).getByRole('link', { name: '經典調酒' }),
    ).toHaveCount(0);

    // tab bar 本體高度落在 56px＋安全區距的範圍內
    const box = await tabBar(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(80);
    // 導覽列固定在視窗下緣
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);
  });

  test('目前頁面對應的 tab 帶 aria-current="page"，點擊 tab 可切換頁面', async ({ page }) => {
    test.skip(!isMobileViewport(page), 'aria-current 情境為行動版限定');

    await page.goto('/classic');
    const tab = tabBar(page);
    await expect(tab.getByRole('link', { name: '經典調酒' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tab.getByRole('link', { name: '首頁' })).not.toHaveAttribute('aria-current', /.*/);

    await tab.getByRole('link', { name: '手邊有什麼' }).click();
    await expect(page).toHaveURL(/\/match$/);
    await expect(tab.getByRole('link', { name: '手邊有什麼' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // 點回首頁
    await tab.getByRole('link', { name: '首頁' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
