/**
 * 版面響應式情境測試。
 *
 * 驗證行動版（375px）不破版、比對模式在行動版為上下堆疊、
 * 平板（768px）無水平溢位且抽屜不蓋滿整屏、
 * 桌面版（1440px）比對模式為左右分欄，並確認進場動畫的降級行為。
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

  test('375px 下比對模式的勾選提示為「在上方」（面板在結果之上）', async ({ page }) => {
    await page.goto('/match');

    await expect(matchPanel(page).getByText('在上方勾選')).toBeVisible();
    // 「在左側」的字樣仍存在 DOM（切換斷點顯示），行動版上不得顯示
    await expect(matchPanel(page).getByText('在左側勾選')).toBeHidden();
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

  test('375px 下卡片的進場延遲堆疊收斂為 0（內容立即出現）', async ({ page }) => {
    await page.goto('/');

    // 第 5 張精選卡的 inline 延遲原本是 240ms，手機上應被收斂為 0
    const card = page
      .getByRole('list', { name: '精選熱選調酒' })
      .getByRole('listitem')
      .nth(4)
      .locator('article');
    await expect(card).toHaveCSS('animation-delay', '0s');
  });
});

test.describe('平板 768px', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('768px 下首頁與瀏覽頁沒有水平溢位，詳情抽屜不蓋滿整屏', async ({ page }) => {
    await page.goto('/');
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.goto('/classic');
    await expect(page.getByRole('heading', { level: 1, name: '經典調酒' })).toBeVisible();
    // 篩選列的主題 chips 走橫向捲動而非斷行破版
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // 抽屜維持 max-w 行為：平板寬度不蓋滿整屏
    await page.goto('/recipe/negroni');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    const panelWidth = await drawer.evaluate((dialog) => {
      const panel = dialog.querySelector<HTMLElement>('[tabindex="-1"]');
      return panel?.offsetWidth ?? 0;
    });
    expect(panelWidth).toBeGreaterThan(0);
    expect(panelWidth).toBeLessThan(768);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

test.describe('桌面版 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('1440px 下詳情抽屜維持 max-w 行為（不蓋滿整屏）', async ({ page }) => {
    await page.goto('/recipe/negroni');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    const panelWidth = await drawer.evaluate((dialog) => {
      const panel = dialog.querySelector<HTMLElement>('[tabindex="-1"]');
      return panel?.offsetWidth ?? 0;
    });
    expect(panelWidth).toBeGreaterThan(0);
    expect(panelWidth).toBeLessThanOrEqual(576); // max-w-xl
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test('1440px 維持卡片進場的階梯延遲（僅手機收斂）', async ({ page }) => {
    await page.goto('/');
    const card = page
      .getByRole('list', { name: '精選熱選調酒' })
      .getByRole('listitem')
      .nth(4)
      .locator('article');
    await expect(card).toHaveCSS('animation-delay', '0.24s');
  });

  test('偏好減少動態時，捲動進場內容直接顯示最終狀態', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    // 「精選熱選」在首屏之下，一般情況要捲動才會進場淡入；
    // 減少動態時應直接是最終狀態（祖先鏈完全透明度 1）。
    await expect(page.getByRole('heading', { name: '精選熱選' })).toBeAttached();
    const allOpaque = await page
      .getByRole('heading', { name: '精選熱選' })
      .evaluate((heading) => {
        let node: HTMLElement | null = heading as HTMLElement;
        while (node && node !== document.body) {
          if (Number(getComputedStyle(node).opacity) < 0.99) return false;
          node = node.parentElement;
        }
        return true;
      });
    expect(allOpaque).toBe(true);
  });

  test('1440px 下比對模式為左右分欄', async ({ page }) => {
    await page.goto('/match');

    // 桌機材料面板在左欄，提示文案維持「在左側勾選」
    await expect(matchPanel(page).getByText('在左側勾選')).toBeVisible();

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
