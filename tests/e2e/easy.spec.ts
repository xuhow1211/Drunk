/**
 * 超商調酒專區（/easy）情境測試。
 *
 * 涵蓋：頁面標題與預設「便利商店」篩選（26 杯）、點卡開啟詳情抽屜，
 * 以及主題列的「超商調酒」chip 在本頁可解除預設篩選。
 */
import { expect, test, type Page } from '@playwright/test';

/** 配方卡片（RecipeCard 以按鈕呈現，帶 data-recipe-id）。 */
function recipeCards(page: Page) {
  return page.locator('button[data-recipe-id]');
}

test.describe('超商調酒專區', () => {
  test('頁面標題為超商調酒，預設呈現便利商店標籤的 26 杯', async ({ page }) => {
    await page.goto('/easy');

    await expect(page.getByRole('heading', { level: 1, name: '超商調酒' })).toBeVisible();
    await expect(page.getByText('材料在便利商店就買得到')).toBeVisible();
    await expect(recipeCards(page).first()).toBeVisible();
    await expect(page.getByText('26 杯', { exact: true })).toBeVisible();

    // 預設篩選（便利商店）已掛在主題列上
    const themeBar = page.getByLabel('主題');
    await expect(themeBar.getByRole('button', { name: '超商調酒' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('點配方卡開啟詳情抽屜', async ({ page }) => {
    await page.goto('/easy');
    await expect(recipeCards(page).first()).toBeVisible();

    await recipeCards(page).first().click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: '材料' })).toBeVisible();
    await expect(page).toHaveURL(/\/recipe\//);
  });

  test('解除「超商調酒」主題 chip 後結果增加（顯示全部系列）', async ({ page }) => {
    await page.goto('/easy');
    await expect(recipeCards(page).first()).toBeVisible();

    const themeBar = page.getByLabel('主題');
    await expect(page.getByText('26 杯', { exact: true })).toBeVisible();

    await themeBar.getByRole('button', { name: '超商調酒' }).click();

    // 解除預設標籤後不做系列篩選，應顯示全部 396 杯
    await expect(page.getByText('396 杯', { exact: true })).toBeVisible();
  });
});
