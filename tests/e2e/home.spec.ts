/**
 * 首頁情境測試。
 *
 * 涵蓋：首頁載入、三大入口導覽、精選熱選橫向捲動、資料統計數字。
 */
import { expect, test } from '@playwright/test';
import { blockExternalRadio, collectConsoleErrors, homeTitle, scrollIntoView } from './helpers';

test.describe('首頁', () => {
  test('首頁載入成功，主標「join 這麼喝」可見且沒有 console 錯誤', async ({ page }) => {
    // 背景音連線的外部電台串流間歇回 403，屬外部服務問題，
    // 攔截後讓應用走合成音降級路徑，避免假失敗。
    await blockExternalRadio(page);
    const errors = collectConsoleErrors(page);

    await page.goto('/');

    await expect(homeTitle(page)).toBeVisible();
    await expect(homeTitle(page)).toHaveText('join 這麼喝');
    await expect(page.getByRole('navigation', { name: '主導覽' })).toBeVisible();
    await expect(
      page.getByRole('main').getByText('勾選手邊材料，即刻算出只差最少的那一杯'),
    ).toBeVisible();

    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('三大入口卡片可見且可點擊，點擊後導向正確路由', async ({ page }) => {
    await page.goto('/');

    const entries = page.getByRole('region', { name: '主要入口' });
    await expect(entries).toBeVisible();

    const targets: ReadonlyArray<{ title: string; path: string }> = [
      { title: '經典調酒', path: '/classic' },
      { title: '熱門推薦', path: '/popular' },
      { title: '我手邊有什麼', path: '/match' },
    ];

    for (const target of targets) {
      const link = entries.getByRole('link', { name: target.title });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${target.path}$`));
      await page.goBack();
      await expect(homeTitle(page)).toBeVisible();
      await expect(homeTitle(page)).toHaveText('join 這麼喝');
    }
  });

  test('精選熱選橫向捲動區有卡片（12 杯熱門調酒）', async ({ page }) => {
    await page.goto('/');

    const section = page.getByRole('region', { name: '精選熱選' });
    await scrollIntoView(page, section);

    const carousel = page.getByRole('list', { name: '精選熱選調酒' });
    await expect(carousel).toBeVisible();
    await expect(carousel.getByRole('listitem')).toHaveCount(12);
    await expect(carousel.getByRole('listitem').first()).toBeVisible();
  });

  test('數據帶顯示的配方數與食材數與資料一致（392 杯、333 項）', async ({ page }) => {
    await page.goto('/');

    const stats = page.getByRole('region', { name: '資料統計' });
    await scrollIntoView(page, stats);

    // 數字有進場動畫，等候動畫結束後再讀取
    const recipeStat = stats.getByText('總配方數').locator('..');
    await expect(recipeStat.getByText('392 杯')).toBeVisible({ timeout: 15_000 });

    const ingredientStat = stats.getByText('總食材數').locator('..');
    await expect(ingredientStat.getByText('333 項')).toBeVisible({ timeout: 15_000 });
  });
});
