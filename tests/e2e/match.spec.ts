/**
 * 比對模式（我手邊有什麼）情境測試。
 *
 * 涵蓋：材料勾選與取消、搜尋、排序、缺料分級與替代建議。
 */
import { expect, test } from '@playwright/test';
import {
  deselectIngredient,
  ingredientChip,
  ingredientSearch,
  matchPanel,
  pickerPanel,
  resultCards,
  resultIds,
  selectIngredient,
} from './helpers';

test.describe('比對模式', () => {
  test('/match 載入成功，材料面板與結果區可見', async ({ page }) => {
    await page.goto('/match');

    await expect(page.getByRole('heading', { level: 1, name: '我手邊有什麼' })).toBeVisible();
    await expect(pickerPanel(page)).toBeVisible();
    await expect(matchPanel(page)).toBeVisible();
    await expect(matchPanel(page).getByText('先選幾樣手邊的材料')).toBeVisible();
    await expect(pickerPanel(page).getByText('已選 0 種')).toBeVisible();
  });

  test('勾選伏特加與柳橙汁後，結果出現 Screwdriver 螺絲起子且顯示零缺料', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '伏特加');
    await selectIngredient(page, '柳橙汁');

    const cards = resultCards(page);
    await expect(cards.first()).toHaveAttribute('data-recipe-id', 'screwdriver');

    const screwdriver = cards.first();
    await expect(screwdriver.getByRole('heading', { name: '螺絲起子', exact: true })).toBeVisible();
    await expect(screwdriver.getByText('Screwdriver')).toBeVisible();
    // 零缺料的兩處提示：缺料徽章與右側缺料清單
    await expect(screwdriver.getByText('材料齊全，可直接調')).toBeVisible();
    await expect(screwdriver.getByText('手邊材料剛好齊全，直接開調吧。')).toBeVisible();
    await expect(screwdriver.getByText(/缺 \d+ 樣/)).toHaveCount(0);
  });

  test('勾選材料後結果順序依缺料分數改變', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '柳橙汁');
    const before = await resultIds(page);
    expect(before.length).toBeGreaterThan(0);

    await selectIngredient(page, '伏特加');
    const after = await resultIds(page);

    expect(after.length).toBeGreaterThan(0);
    expect(after[0]).not.toBe(before[0]);
    // 補上伏特加後，缺料最少的螺絲起子應排到第一位
    expect(after[0]).toBe('screwdriver');
  });

  test('點選材料晶片可取消選取，結果數量隨之變化', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '伏特加');
    await expect(pickerPanel(page).getByText('已選 1 種')).toBeVisible();
    await expect(resultCards(page)).toHaveCount(24);

    await deselectIngredient(page, '伏特加');
    await expect(pickerPanel(page).getByText('已選 0 種')).toBeVisible();
    await expect(resultCards(page)).toHaveCount(0);
    await expect(matchPanel(page).getByText('先選幾樣手邊的材料')).toBeVisible();
  });

  test('「一鍵清空」按鈕可清空已選材料', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '伏特加');
    await selectIngredient(page, '柳橙汁');
    await expect(pickerPanel(page).getByText('已選 2 種')).toBeVisible();
    await expect(resultCards(page).first()).toBeVisible();

    await pickerPanel(page).getByRole('button', { name: '一鍵清空' }).click();

    await expect(pickerPanel(page).getByText('已選 0 種')).toBeVisible();
    await expect(resultCards(page)).toHaveCount(0);
    await expect(pickerPanel(page).getByRole('button', { name: '一鍵清空' })).toBeDisabled();
  });

  test('搜尋框可輸入中文或英文並篩出材料晶片', async ({ page }) => {
    await page.goto('/match');

    const search = ingredientSearch(page);

    await search.fill('伏特加');
    await expect(pickerPanel(page).getByText('搜尋「伏特加」找到 1 項')).toBeVisible();
    await expect(ingredientChip(page, '伏特加')).toBeVisible();

    await search.fill('Vodka');
    await expect(ingredientChip(page, '伏特加')).toBeVisible();

    await search.fill('烈酒');
    await expect(pickerPanel(page).getByText(/找到 \d+ 項/)).toBeVisible();

    await search.fill('這個材料不存在');
    await expect(pickerPanel(page).getByText('找不到符合的材料')).toBeVisible();
  });

  test('切換排序選項後結果順序改變', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '伏特加');
    await selectIngredient(page, '柳橙汁');

    const sortGroup = matchPanel(page).getByRole('group', { name: '結果排序' });
    await expect(sortGroup.getByRole('button', { name: '最接近' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const closest = await resultIds(page);

    await sortGroup.getByRole('button', { name: '最熱門' }).click();
    await expect(sortGroup.getByRole('button', { name: '最熱門' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const popular = await resultIds(page);
    expect(popular[0]).not.toBe(closest[0]);

    await sortGroup.getByRole('button', { name: '缺料最少' }).click();
    const fewest = await resultIds(page);
    expect(fewest).not.toEqual(closest);

    await sortGroup.getByRole('button', { name: '最快完成' }).click();
    const fastest = await resultIds(page);
    expect(fastest).not.toEqual(closest);
  });

  test('缺基酒的結果卡顯示「缺的是主酒」警示', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '伏特加');
    await selectIngredient(page, '柳橙汁');

    const warning = matchPanel(page).getByText('缺的是主酒，這杯要另外買');
    await expect(warning.first()).toBeVisible();
    expect(await warning.count()).toBeGreaterThan(0);
  });

  test('有替代品時顯示「可用 X 代替 Y」提示', async ({ page }) => {
    await page.goto('/match');

    await selectIngredient(page, '伏特加');
    await selectIngredient(page, '柳橙汁');

    // 手邊的伏特加可替代缺少的琴酒／白蘭姆酒
    await expect(matchPanel(page).getByText(/可用 伏特加 代替 /).first()).toBeVisible();
    await expect(
      matchPanel(page).getByText('可用 伏特加 代替 琴酒（金酒）').first(),
    ).toBeVisible();
  });
});
