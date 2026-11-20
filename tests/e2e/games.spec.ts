/**
 * 吹牛骰子房間系統的情境測試（兩個瀏覽器對局大廳流程）。
 *
 * 需要本機憑證：SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（缺一即跳過，
 * CI 上不具備這兩個環境變數）。前置以 service key 經 Auth Admin REST
 * （node 內建 fetch；不用 supabase-js，避免其 realtime 子模組在
 * 無原生 WebSocket 的 Node 20 上於建構時即崩潰）建立兩個已確認的測試帳號。
 *
 * 情境：A 登入、建立房間 → B 登入後以房間 ID 加入 → 兩端大廳即時同步 →
 * 房主（A）調整設定、B 端同步 → A 離開房間（房主移交 B） → B 離開（房間關閉）。
 */
import { expect, test, type Page } from '@playwright/test';

/** Supabase 連線資訊（本機憑證；缺一時整組跳過）。 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CREDENTIALS_READY = Boolean(SUPABASE_URL && SERVICE_KEY);

/** 測試帳號 A（房主）。 */
const USER_A = { email: 'e2e-p2-a@example.test', name: '骰王A' };
/** 測試帳號 B（加入者）。 */
const USER_B = { email: 'e2e-p2-b@example.test', name: '骰小B' };
/** 測試帳號共用的密碼（與主控啟動時的設定一致）。 */
const TEST_PASSWORD = process.env.E2E_GAME_PASSWORD ?? 'dice-e2e-pass';

/** 從大廳頁面的網址抽出 6 碼房間 ID。 */
function roomIdFromUrl(url: string): string {
  const match = /\/games\/room\/([A-Z0-9]{6})/.exec(url);
  if (!match) throw new Error(`網址未含 6 碼房間 ID：${url}`);
  return match[1] as string;
}

/**
 * 組出管理 API（auth admin 與 PostgREST）共用的請求標頭。
 *
 * @param extra 額外標頭（例如 Content-Type、Prefer）
 */
function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_KEY!,
    Authorization: `Bearer ${SERVICE_KEY!}`,
    ...extra,
  };
}

/**
 * 以信箱在 auth admin 分頁清單中找出使用者 ID。
 *
 * @param email 測試帳號信箱
 */
async function findUserIdByEmail(email: string): Promise<string | undefined> {
  for (let pageNo = 1; pageNo <= 5; pageNo += 1) {
    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${pageNo}&per_page=200`,
      { headers: adminHeaders() },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as { users?: Array<{ id: string; email?: string }> };
    const users = body.users ?? [];
    const hit = users.find((item) => item.email === email);
    if (hit) return hit.id;
    if (users.length < 200) return undefined;
  }
  return undefined;
}

/**
 * 以信箱刪除既有使用者（不存在時靜默略過）。
 *
 * @param email 測試帳號信箱
 */
async function deleteUserByEmail(email: string): Promise<void> {
  const userId = await findUserIdByEmail(email);
  if (!userId) return;
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
}

/**
 * 以 auth admin REST 建立已確認信箱的測試帳號（已存在時忽略 422 續行）。
 *
 * @param user 信箱與顯示名稱
 */
async function createConfirmedUser(user: { email: string; name: string }): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      email: user.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: user.name },
    }),
  });
  // 422：users 表已存在同信箱——視為成功續行
  if (!response.ok && response.status !== 422) {
    throw new Error(`建立測試帳號失敗（${user.email}）：HTTP ${response.status}`);
  }
}

/**
 * 以 PostgREST upsert 補寫 profiles.display_name（admin 建號不觸發觸發器）。
 *
 * @param userId 使用者 ID
 * @param displayName 大廳顯示名稱
 */
async function upsertProfileName(userId: string, displayName: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: adminHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    }),
    body: JSON.stringify([{ id: userId, display_name: displayName }]),
  });
}

/**
 * 以 UI 完成登入，成功後回到首頁。
 *
 * @param page 目標頁面
 * @param email 測試帳號信箱
 */
async function signInViaUi(page: Page, email: string): Promise<void> {
  await page.goto('/auth');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('密碼').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL('/');
}

test.skip(!CREDENTIALS_READY, '需要本機憑證：SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY');

// 多人情境共用一組測試帳號與外部資料庫狀態：僅在桌機專案執行一次，
// 避免 desktop／mobile 兩個 worker 同時刪建帳號與搶房間造成競態。
test.skip((): boolean => {
  // 專案名稱以 workerInfo 取得：僅桌機專案執行，避免雙 worker 搶同一組帳號
  return test.info().project.name !== 'desktop-1440';
});

test.describe('吹牛骰子房間系統', () => {
  test.beforeAll(async () => {
    for (const user of [USER_A, USER_B]) {
      // 求乾淨：先刪既有測試帳號再重建（不存在時刪除靜默略過）
      await deleteUserByEmail(user.email);
      await createConfirmedUser(user);
      // 大廳的顯示名稱讀自 profiles：admin API 建號不觸發觸發器的命名，
      // 以 service key 補寫 profiles.display_name（bypass RLS 亦不經對話）
      const userId = await findUserIdByEmail(user.email);
      if (userId) await upsertProfileName(userId, user.name);
    }
  });

  test('建房、加入、同步、房主移交與關房', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    // A 登入並建立房間
    await signInViaUi(page, USER_A.email);
    await page.goto('/games');
    await page.getByRole('button', { name: '建立新房間' }).click();
    await expect(page).toHaveURL(/\/games\/room\/[A-Z0-9]{6}/);
    const roomId = roomIdFromUrl(page.url());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(roomId);
    // Nav 的顯示名稱與玩家卡都會出現名字：限定在大廳的玩家卡片內斷言
    await expect(page.getByRole('listitem').filter({ hasText: '骰王A' }).first()).toBeVisible();

    // B 於另一個瀏覽器 context 登入，以房間 ID 加入
    const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-TW' });
    const pageB = await contextB.newPage();
    pageB.on('pageerror', (error) => consoleErrors.push(`B: ${error.message}`));
    await signInViaUi(pageB, USER_B.email);
    await pageB.goto('/games');
    await pageB.getByLabel('房間 ID').fill(roomId);
    await pageB.getByRole('button', { name: '加入', exact: true }).click();
    await expect(pageB).toHaveURL(new RegExp(`/games/room/${roomId}`));

    // 即時同步：A 的大廳名單出現 B（pg_changes → 重抓成員）
    await expect(page.getByText('骰小B')).toBeVisible();
    // 連線狀態：綁定 B 的卡片驗證 presence 顯示在線
    const rowA = page.getByRole('listitem').filter({ hasText: '骰小B' });
    await expect(rowA.getByText('在線')).toBeVisible({ timeout: 20_000 });

    // 房主調整設定（骰子數 5 → 4），B 端即時同步
    await page.getByRole('button', { name: '遊戲設定（房主）' }).click();
    await page.getByRole('button', { name: '減少每人骰子數' }).click();
    await expect(page.getByText(/每人 4 顆骰子/)).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(/每人 4 顆骰子/)).toBeVisible({ timeout: 15_000 });

    // A 離開房間：房主移交給 B
    const rowB = pageB.getByRole('listitem').filter({ hasText: '骰小B' });
    await page.getByRole('button', { name: '離開房間' }).click();
    await expect(page).toHaveURL('/games');
    await expect(rowB.getByText('房主')).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByRole('listitem').filter({ hasText: '骰王A' })).toHaveCount(0);
    // B 的開始遊戲列已切換為房主視角（人數不足 2 的房主視角按鈕出現）
    await expect(pageB.getByRole('button', { name: /開始遊戲/ })).toBeVisible();

    // B 離開房間：房內無人，房間自動關閉
    await pageB.getByRole('button', { name: '離開房間' }).click();
    await expect(pageB).toHaveURL('/games');

    // 以 PostgREST 驗證房間狀態已轉為 closed
    await expect
      .poll(async () => {
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/game_rooms?room_id=eq.${roomId}&select=status&limit=1`,
          { headers: adminHeaders() },
        );
        if (!response.ok) return undefined;
        const rows = (await response.json()) as Array<{ status: string }>;
        return rows[0]?.status;
      }, { timeout: 15_000 })
      .toBe('closed');

    // 兩端大廳不應有未捕捉例外（console 錯誤另行檢查）
    expect(consoleErrors).toEqual([]);
    await contextB.close();
  });
});
