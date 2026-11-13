/**
 * 情境測試共用工具。
 *
 * 以「可及性名稱」（aria-label、角色）定位元素，
 * 讓測試對應使用者實際看到的內容與操作方式，而不是依賴 CSS 類別。
 */
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 背景音功能會連線的外部電台串流網域。
 *
 * 該外部服務間歇回應 403，屬外部服務不穩定，與本應用的正確性無關；
 * 情境測試一律攔截此網域的請求，並排除此網域產生的 console 錯誤。
 */
const EXTERNAL_RADIO_URL = /ice1\.somafm\.com/;

/**
 * 蒐集頁面上的 console 錯誤與未捕捉例外。
 *
 * 排除外部電台串流網域產生的錯誤：該網域間歇回 403，
 * 是外部服務問題，不應造成本應用的情境測試假失敗。
 *
 * @param page Playwright 頁面
 * @returns 可即時讀取的錯誤陣列
 */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (EXTERNAL_RADIO_URL.test(message.location()?.url ?? '')) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * 攔截外部電台串流的請求（直接中止，不送出真實網路請求）。
 *
 * 應用端對連不上串流的降級路徑（合成環境音）是真實路徑，
 * 攔截後應用照常運作，且測試不再受外部服務間歇性 403 影響。
 *
 * @param page Playwright 頁面
 */
export async function blockExternalRadio(page: Page): Promise<void> {
  await page.route(EXTERNAL_RADIO_URL, (route) => route.abort());
}

/**
 * 材料選擇器面板。
 *
 * @param page Playwright 頁面
 */
export function pickerPanel(page: Page): Locator {
  return page.getByRole('region', { name: '材料選擇器' });
}

/**
 * 比對結果面板。
 *
 * @param page Playwright 頁面
 */
export function matchPanel(page: Page): Locator {
  return page.getByRole('region', { name: '比對結果' });
}

/**
 * 首頁主標。
 *
 * 主標以逐字動畫呈現，每個字元都是獨立的 inline-block 元素，
 * 可及性名稱會被拆成「j o i n 這 麼 喝」，因此改以標題層級定位、再比對文字內容。
 *
 * @param page Playwright 頁面
 */
export function homeTitle(page: Page): Locator {
  return page.getByRole('heading', { level: 1 });
}

/**
 * 材料搜尋框。
 *
 * @param page Playwright 頁面
 */
export function ingredientSearch(page: Page): Locator {
  return pickerPanel(page).getByRole('searchbox', { name: '搜尋材料' });
}

/**
 * 材料晶片（依中文名稱精確比對）。
 *
 * @param page Playwright 頁面
 * @param name 材料中文名稱
 */
export function ingredientChip(page: Page, name: string): Locator {
  return pickerPanel(page).getByRole('button', { name, exact: true });
}

/**
 * 以搜尋框找到材料並勾選。
 *
 * @param page Playwright 頁面
 * @param name 材料中文名稱
 */
export async function selectIngredient(page: Page, name: string): Promise<void> {
  const search = ingredientSearch(page);
  await search.fill(name);
  const chip = ingredientChip(page, name);
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
}

/**
 * 再次點擊已勾選的材料晶片以取消勾選。
 *
 * @param page Playwright 頁面
 * @param name 材料中文名稱
 */
export async function deselectIngredient(page: Page, name: string): Promise<void> {
  const chip = ingredientChip(page, name);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
}

/**
 * 目前顯示的比對結果卡（每張卡是一個 article 元素）。
 *
 * @param page Playwright 頁面
 */
export function resultCards(page: Page): Locator {
  return matchPanel(page).locator('article');
}

/**
 * 讀取目前結果清單的配方 id 順序。
 *
 * @param page Playwright 頁面
 */
export async function resultIds(page: Page): Promise<string[]> {
  const ids = await resultCards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-recipe-id') ?? ''),
  );
  return ids;
}

/**
 * 確認篩選列的篩選條件已展開（行動版預設收合）。
 *
 * @param page Playwright 頁面
 */
export async function ensureFilterGroupsExpanded(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /展開篩選條件|收合篩選條件/ });
  if ((await toggle.count()) === 0) return;
  const label = (await toggle.first().textContent()) ?? '';
  if (label.includes('展開')) {
    await toggle.first().click();
  }
}

/**
 * 判斷頁面是否出現水平溢位（內容寬度超過視窗寬度）。
 *
 * @param page Playwright 頁面
 */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
}

/**
 * 等待頁面捲動到指定元素（動畫元素需要進入視窗才會啟動）。
 *
 * @param page Playwright 頁面
 * @param target 目標元素
 */
export async function scrollIntoView(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
}
