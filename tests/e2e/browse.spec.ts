/**
 * 瀏覽模式（經典調酒／熱門推薦）情境測試。
 *
 * 涵蓋：頁面載入、篩選、搜尋、空狀態、詳情抽屜、深層連結與 404。
 */
import { expect, test, type Page } from '@playwright/test';
import { ensureFilterGroupsExpanded } from './helpers';

/** 配方卡片（RecipeCard 以按鈕呈現，帶 data-recipe-id）。 */
function recipeCards(page: Page) {
  return page.locator('button[data-recipe-id]');
}

test.describe('瀏覽模式', () => {
  test('/classic 與 /popular 載入成功，卡片數大於零', async ({ page }) => {
    await page.goto('/classic');
    await expect(page.getByRole('heading', { level: 1, name: '經典調酒' })).toBeVisible();
    await expect(recipeCards(page).first()).toBeVisible();
    expect(await recipeCards(page).count()).toBeGreaterThan(0);
    await expect(page.getByText('102 杯', { exact: true })).toBeVisible();

    await page.goto('/popular');
    await expect(page.getByRole('heading', { level: 1, name: '熱門推薦' })).toBeVisible();
    await expect(recipeCards(page).first()).toBeVisible();
    expect(await recipeCards(page).count()).toBeGreaterThan(0);
    await expect(page.getByText('141 杯', { exact: true })).toBeVisible();
  });

  test('選取分類後結果數量減少，且剩餘卡片的分類皆相符', async ({ page }) => {
    await page.goto('/classic');
    await ensureFilterGroupsExpanded(page);

    const filterBar = page.getByRole('region', { name: '篩選與排序' });
    const before = await recipeCards(page).count();
    expect(before).toBeGreaterThan(0);

    await filterBar.getByRole('button', { name: '高球類 Highball' }).click();

    await expect(filterBar.getByText('11 杯', { exact: true })).toBeVisible();
    const after = await recipeCards(page).count();
    expect(after).toBeLessThan(before);
    expect(after).toBe(11);

    for (const card of await recipeCards(page).all()) {
      await expect(card.getByText('高球類 Highball')).toBeVisible();
    }
  });

  test('以中文與英文名稱搜尋都可找到對應配方', async ({ page }) => {
    await page.goto('/classic');

    const search = page.getByRole('searchbox', { name: '搜尋調酒' });

    await search.fill('Negroni');
    await expect(recipeCards(page)).toHaveCount(1);
    await expect(recipeCards(page).first().getByText('尼格羅尼')).toBeVisible();

    await search.fill('尼格羅尼');
    await expect(recipeCards(page)).toHaveCount(1);
    await expect(recipeCards(page).first().getByText('尼格羅尼')).toBeVisible();

    // 以原料名稱搜尋也找得到（濾酒條件比對原料中文名）
    await search.fill('琴酒');
    const byIngredient = await recipeCards(page).count();
    expect(byIngredient).toBeGreaterThan(1);
  });

  test('篩選無結果時顯示空狀態與清除按鈕', async ({ page }) => {
    await page.goto('/classic');

    const search = page.getByRole('searchbox', { name: '搜尋調酒' });
    await search.fill('這個配方一定不存在');

    await expect(page.getByText('沒有符合條件的調酒')).toBeVisible();
    const clearButton = page.getByRole('button', { name: '清除篩選' });
    await expect(clearButton).toBeVisible();

    await clearButton.click();
    await expect(recipeCards(page).first()).toBeVisible();
    expect(await recipeCards(page).count()).toBeGreaterThan(0);
  });

  test('點配方卡開啟詳情抽屜，抽屜含材料表、步驟與來源連結', async ({ page }) => {
    await page.goto('/classic');

    await recipeCards(page).first().click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: '材料' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: '步驟' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: '來源' })).toBeVisible();
    await expect(drawer.locator('a[href^="http"]').first()).toBeVisible();
    // 網址同步為深層連結
    await expect(page).toHaveURL(/\/recipe\//);
  });

  test('詳情抽屜可透過 Esc 關閉', async ({ page }) => {
    await page.goto('/classic');

    await recipeCards(page).first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/\/recipe\//);
    // 等待淡入動畫與焦點鎖定完成，確保 Esc 監聽已掛上
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');

    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/classic$/);
    await expect(recipeCards(page).first()).toBeVisible();
  });

  test('深層連結 /recipe/negroni 可直接開啟配方詳情', async ({ page }) => {
    await page.goto('/recipe/negroni');

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: '尼格羅尼' })).toBeVisible();
    await expect(page).toHaveURL(/\/recipe\/negroni$/);
    // 背景路由未被破壞：主框架與導覽列仍在
    await expect(page.getByRole('navigation', { name: '主導覽' })).toBeVisible();
  });

  test('不存在的配方路徑顯示 404 頁', async ({ page }) => {
    await page.goto('/recipe/this-does-not-exist');

    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByText('這個頁面不存在，或配方編號有誤。')).toBeVisible();
    await expect(page.getByRole('link', { name: '回到首頁' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
