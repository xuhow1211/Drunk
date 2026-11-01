/**
 * 手邊材料共享狀態與選用材料的情境測試。
 *
 * 涵蓋三個重點情境：
 *   1. 一鍵加入手邊材料後，比對結果會改變。
 *   2. 選用材料不會被列為缺料。
 *   3. 已加入的材料在重新整理後仍然保留。
 */
import { expect, test, type Page } from '@playwright/test';
import {
  ingredientChip,
  ingredientSearch,
  matchPanel,
  pickerPanel,
  resultCards,
  resultIds,
  selectIngredient,
} from './helpers';

/** 頁面上所有「加入我的手邊」按鈕。 */
function addToOwnedButtons(page: Page) {
  return page.locator('[data-add-to-owned="true"]');
}

/** 依配方 id 找到對應配方卡上的「加入我的手邊」按鈕。 */
function addToOwnedButtonOf(page: Page, recipeId: string) {
  return page
    .locator(`article:has(button[data-recipe-id="${recipeId}"])`)
    .locator('[data-add-to-owned="true"]')
    .first();
}

test.describe('手邊材料共享狀態', () => {
  test('在配方卡按「加入我的手邊」後，比對結果立即出現該杯', async ({ page }) => {
    await page.goto('/classic');

    // 從尼格羅尼的配方卡一鍵加入三種材料
    const negroniAdd = addToOwnedButtonOf(page, 'negroni');
    await expect(negroniAdd).toBeVisible();
    await negroniAdd.click();

    // 按鈕切換為已加入狀態
    await expect(negroniAdd).toHaveAttribute('aria-pressed', 'true');
    await expect(negroniAdd).toHaveText('已加入我的材料');

    // 切到比對模式，手邊材料已是那三樣
    await page.goto('/match');
    await expect(pickerPanel(page).getByText('已選 3 種')).toBeVisible();
    await expect(resultCards(page).first()).toHaveAttribute('data-recipe-id', 'negroni');
    // 尼格羅尼的三種材料都在手邊，缺料清單顯示可直接開調
    const negroni = matchPanel(page).locator('article[data-recipe-id="negroni"]');
    await expect(negroni.getByText('手邊材料剛好齊全，直接開調吧。')).toBeVisible();
  });

  test('加入手邊材料後再按一次可移除，結果清單同步變化', async ({ page }) => {
    await page.goto('/classic');

    const negroniAdd = addToOwnedButtonOf(page, 'negroni');
    await negroniAdd.click();
    await expect(negroniAdd).toHaveAttribute('aria-pressed', 'true');

    // 再次點擊即為移除
    await negroniAdd.click();
    await expect(negroniAdd).toHaveAttribute('aria-pressed', 'false');
    await expect(negroniAdd).toHaveText('＋ 加入我的手邊');

    await page.goto('/match');
    await expect(pickerPanel(page).getByText('已選 0 種')).toBeVisible();
    await expect(resultCards(page)).toHaveCount(0);
  });

  test('「加入我的手邊」保留既有勾選，既有材料不會被清掉', async ({ page }) => {
    await page.goto('/match');

    // 先手動勾一項（琴酒是尼格羅尼的材料之一）
    await selectIngredient(page, '琴酒（金酒）');
    await expect(pickerPanel(page).getByText('已選 1 種')).toBeVisible();

    // 再從配方卡加入尼格羅尼的全部材料（琴酒＋金巴利＋甜味美思）
    await page.goto('/classic');
    const negroniAdd = addToOwnedButtonOf(page, 'negroni');
    await expect(negroniAdd).toBeVisible();
    await negroniAdd.click();

    await page.goto('/match');
    // 琴酒仍被保留，總數是 3 種而不是被取代成 3 種中的 1 種
    await expect(pickerPanel(page).getByText('已選 3 種')).toBeVisible();
  });

  test('選用材料不會被列為缺料', async ({ page }) => {
    await page.goto('/match');

    // 餘暉（Afterglow）的冰塊是選用材料
    await selectIngredient(page, '紅石榴糖漿');
    await selectIngredient(page, '柳橙汁');
    await selectIngredient(page, '鳳梨汁');

    const afterglow = matchPanel(page).locator('article[data-recipe-id="afterglow"]');
    await expect(afterglow).toHaveCount(1);

    // 冰塊不算缺料：缺料徽章顯示零缺料
    await expect(afterglow.getByText('材料齊全，可直接調')).toBeVisible();
    await expect(afterglow.getByText(/缺 \d+ 樣/)).toHaveCount(0);
    await expect(afterglow.getByText('手邊材料剛好齊全，直接開調吧。')).toBeVisible();

    // 冰塊不會出現在缺料清單中：整張卡只會在「另有選用」那一行提到冰塊
    await expect(afterglow.getByText('冰塊')).toHaveCount(1);
    // 但會以較弱的樣式另行列出
    await expect(afterglow.getByText('另有選用：冰塊')).toBeVisible();
  });

  test('選用材料與真正的缺料分開呈現', async ({ page }) => {
    await page.goto('/match');

    // 威士忌酸酒的蛋白是選用材料，濃糖漿則是真正必須的材料
    await selectIngredient(page, '波本威士忌');
    await selectIngredient(page, '檸檬汁');
    await selectIngredient(page, '糖水（1:1）');
    await selectIngredient(page, '安格仕苦精');
    await selectIngredient(page, '鹽');

    const whiskeySour = matchPanel(page).locator('article[data-recipe-id="whiskey-sour"]');
    await expect(whiskeySour).toHaveCount(1);

    // 真正的缺料照樣列在缺料清單裡
    const missingList = whiskeySour.locator('ul');
    await expect(missingList).toContainText('濃糖漿（2:1）');
    // 選用的蛋白不在缺料清單中
    await expect(missingList).not.toContainText('蛋白');

    // 選用材料另以較弱的樣式標示
    await expect(whiskeySour.getByText('另有選用：蛋白')).toBeVisible();
  });

  test('加入的材料在重新整理後仍然保留', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '伏特加');
    await selectIngredient(page, '柳橙汁');
    await expect(pickerPanel(page).getByText('已選 2 種')).toBeVisible();

    const before = await resultIds(page);
    expect(before.length).toBeGreaterThan(0);

    await page.reload();

    await expect(pickerPanel(page).getByText('已選 2 種')).toBeVisible();

    // 重新整理後搜尋該材料，晶片仍為已勾選狀態
    await ingredientSearch(page).fill('伏特加');
    await expect(ingredientChip(page, '伏特加')).toHaveAttribute('aria-pressed', 'true');

    const after = await resultIds(page);
    expect(after).toEqual(before);
  });

  test('從配方卡加入的材料在重新整理後仍然保留', async ({ page }) => {
    await page.goto('/classic');

    const negroniAdd = addToOwnedButtonOf(page, 'negroni');
    await negroniAdd.click();
    await expect(negroniAdd).toHaveAttribute('aria-pressed', 'true');

    await page.reload();

    // 重新整理後按鈕仍是已加入狀態
    await expect(addToOwnedButtonOf(page, 'negroni')).toHaveAttribute('aria-pressed', 'true');
    await expect(addToOwnedButtonOf(page, 'negroni')).toHaveText('已加入我的材料');
  });

  test('比對模式的加入按鈕與材料選擇器共用同一份狀態', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '柳橙汁');
    await expect(pickerPanel(page).getByText('已選 1 種')).toBeVisible();

    // 結果卡上的「加入我的手邊」也讀同一份狀態：點擊後計數會增加
    const firstAdd = addToOwnedButtons(page).first();
    await firstAdd.click();
    await expect(pickerPanel(page).getByText('已選 2 種')).toBeVisible();
  });

  test('搜尋材料時，已加入的材料仍顯示為已勾選', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '柳橙汁');

    await ingredientSearch(page).fill('柳橙');
    await expect(ingredientChip(page, '柳橙汁')).toHaveAttribute('aria-pressed', 'true');
  });
});
