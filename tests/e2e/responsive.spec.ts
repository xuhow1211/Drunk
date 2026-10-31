/**
 * 版面響應式情境測試。
 *
 * 驗證行動版（375px）不破版、比對模式在行動版為上下堆疊、
 * 桌面版（1440px）比對模式為左右分欄。
 */
import { expect, test } from '@playwright/test';
import { hasHorizontalOverflow, homeTitle, matchPanel, pickerPanel } from './helpers';

test.describe('行動版 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('375px 下比對模式為上下堆疊，且頁面沒有水平溢位', async ({ page }) => {
    await page.goto('/match');

    const pickerBox = await pickerPanel(page).boundingBox();
    const resultsBox = await matchPanel(page).boundingBox();
    expect(pickerBox).not.toBeNull();
    expect(resultsBox).not.toBeNull();

    // 上下堆疊：結果區整個落在材料面板下方
    expect(resultsBox!.y).toBeGreaterThan(pickerBox!.y + pickerBox!.height - 5);
    // 兩者佔用同一個欄位（水平範圍重疊），不是左右並排
    expect(resultsBox!.x).toBeLessThan(pickerBox!.x + pickerBox!.width);

    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test('375px 下首頁沒有水平溢位', async ({ page }) => {
    await page.goto('/');

    await expect(homeTitle(page)).toBeVisible();
    await expect(homeTitle(page)).toHaveText('join 這麼喝');
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // 捲到頁面底部再確認一次（精選熱選是橫向捲動區，容易撐寬頁面）
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(400);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

test.describe('桌面版 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('1440px 下比對模式為左右分欄', async ({ page }) => {
    await page.goto('/match');

    const pickerBox = await pickerPanel(page).boundingBox();
    const resultsBox = await matchPanel(page).boundingBox();
    expect(pickerBox).not.toBeNull();
    expect(resultsBox).not.toBeNull();

    // 左右分欄：結果區在材料面板的右側
    expect(resultsBox!.x).toBeGreaterThan(pickerBox!.x + pickerBox!.width - 5);
    // 兩欄頂端大致對齊
    expect(Math.abs(resultsBox!.y - pickerBox!.y)).toBeLessThan(80);

    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
