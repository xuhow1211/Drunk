/**
 * 吹牛骰子遊戲核心（Phase 3）的情境測試：RPC 對局、UI 對局與逾時代理。
 *
 * 需要本機憑證：SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（缺一即跳過，
 * CI 上不具備這兩個環境變數）。前置以 service key 經 Auth Admin REST
 * （node 內建 fetch；不用 supabase-js，避免其 realtime 子模組在
 * 無原生 WebSocket 的 Node 20 上於建構時即崩潰）建立兩個已確認的測試帳號。
 *
 * 情境：
 *   1. RPC 直接驅動完整對局（起局 → 依 current_seat 輪流 submit_bid →
 *      challenge → reveal／淘汰／dice_left → 二人局結束 → 統計更新）。
 *   2. UI：兩個 context 的 play 頁（雙方看到倒數與自己的骰子、私有隔離、
 *      喊牌 5 秒內同步、質疑後 reveal 與新回合）。
 *   3. 逾時：deadline 過後 sync_timeout 自動代喊（bid_seq=0 → (1,1)），
 *      冪等不重複處理。
 */
import { expect, test, type Page } from '@playwright/test';

/** Supabase 連線資訊（本機憑證；缺一時整組跳過）。 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CREDENTIALS_READY = Boolean(SUPABASE_URL && SERVICE_KEY);

/** 測試帳號 A（房主）。 */
const USER_A = { email: 'e2e-p3-a@example.test', name: '核心A' };
/** 測試帳號 B（加入者）。 */
const USER_B = { email: 'e2e-p3-b@example.test', name: '核心B' };
/** 測試帳號共用的密碼（與主控啟動時的設定一致）。 */
const TEST_PASSWORD = process.env.E2E_GAME_PASSWORD ?? 'dice-e2e-pass';

/** 開盅覆蓋的自動關閉上限（SQL 端停留 6 秒，此處放寬到 15 秒等它隱藏）。 */
const REVEAL_HIDE_TIMEOUT = 15_000;

/** 從大廳頁面的網址抽出 6 碼房間 ID。 */
function roomIdFromUrl(url: string): string {
  const match = /\/games\/room\/([A-HJKMNP-Z2-9]{6})/.exec(url);
  if (!match) throw new Error(`網址未含 6 碼房間 ID：${url}`);
  return match[1] as string;
}

/**
 * 組出管理 API（auth admin 與 PostgREST）共用的請求標頭。
 *
 * @param extra 額外標頭（例如 Content-Type）
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
 * 以密碼換取該帳號的 access_token（作為 RPC 呼叫的 authenticated 身分）。
 *
 * @param email 測試帳號信箱
 */
async function signInToken(email: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`以密碼登入換 token 失敗（${email}）：HTTP ${response.status}`);
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

/**
 * 以指定使用者的 token 呼叫 RPC，回傳解析後的 JSON。
 *
 * @param token 使用者 access_token（authenticated 角色）
 * @param name RPC 名稱
 * @param args RPC 參數
 */
async function callRpc<T = unknown>(
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  // void RPC 會回 204＋空內容：不得直接 res.json()（會丟 Unexpected end of JSON input）
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : undefined;
  if (!response.ok) {
    const message =
      (body as { message?: string; error?: string }).message ??
      String((body as { error?: string }).error ?? '');
    throw new Error(`RPC ${name} 失敗（HTTP ${response.status}）：${message}`);
  }
  return body as T;
}

/**
 * 讀取資料表列（PostgREST；公開表帶任一成員 token亦可）。
 *
 * @param token 使用者 token（私密表須為本人）
 * @param table 資料表名稱
 * @param query 查詢字串（不含前導問號）
 */
async function fetchRows(
  token: string,
  table: string,
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`讀取 ${table} 失敗：HTTP ${response.status}`);
  }
  return (await response.json()) as Array<Record<string, unknown>>;
}

/** 進行中的回合形狀（game_rounds 公開列）。 */
interface RoundRow {
  session_id: number;
  round_no: number;
  current_seat: number;
  bid_count: number | null;
  bid_face: number | null;
  bid_seq: number;
  deadline_at: string;
  status: string;
  reveal: Array<{ user_id: string; dice: number[] }> | null;
  resolve_note: string | null;
}

test.skip(!CREDENTIALS_READY, '需要本機憑證：SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY');

// 多項情境共用一組測試帳號與外部資料庫狀態：僅在桌機專案執行一次、
// 檔內串行，避免雙 worker 同時刪建帳號與搶房間造成競態。
test.skip((): boolean => {
  return test.info().project.name !== 'desktop-1440';
});
test.describe.configure({ mode: 'serial' });

test.describe('吹牛骰子遊戲核心', () => {
  let tokenA = '';
  let tokenB = '';
  let userAId = '';
  let userBId = '';

  test.beforeAll(async () => {
    for (const user of [USER_A, USER_B]) {
      // 求乾淨：先刪既有測試帳號再重建（不存在時刪除靜默略過）
      await deleteUserByEmail(user.email);
      await createConfirmedUser(user);
      const userId = await findUserIdByEmail(user.email);
      if (userId) {
        await upsertProfileName(userId, user.name);
        if (user.email === USER_A.email) userAId = userId;
        else userBId = userId;
      }
    }
    tokenA = await signInToken(USER_A.email);
    tokenB = await signInToken(USER_B.email);
  });

  /** 建房＋B 加入＋A 開局，回傳房間與 session 資訊。 */
  async function setupSession(options: {
    diceCount: number;
    turnSeconds: number;
  }): Promise<{ roomId: string; sessionId: number }> {
    const roomId = await callRpc<string>(tokenA, 'create_room', {
      p_dice_count: options.diceCount,
      p_turn_seconds: options.turnSeconds,
    });
    await callRpc(tokenB, 'join_room', { p_room_id: roomId });
    const sessionId = await callRpc<number>(tokenA, 'start_game', { p_room_id: roomId });
    return { roomId, sessionId };
  }

  /** 讀最新回合（公開表；帶任一成員 token）。 */
  async function latestRound(sessionId: number): Promise<RoundRow> {
    const rows = await fetchRows(
      tokenA,
      'game_rounds',
      `session_id=eq.${sessionId}&order=round_no.desc&limit=1`,
    );
    expect(rows.length).toBe(1);
    return rows[0] as unknown as RoundRow;
  }

  /** 讀局況（公開表）。 */
  async function sessionOf(sessionId: number): Promise<{
    winner: string | null;
    ended_at: string | null;
    settled_at: string | null;
  }> {
    const rows = await fetchRows(
      tokenA,
      'game_sessions',
      `id=eq.${sessionId}&select=id,winner,ended_at,settled_at&limit=1`,
    );
    expect(rows.length).toBe(1);
    return rows[0] as unknown as {
      winner: string | null;
      ended_at: string | null;
      settled_at: string | null;
    };
  }

  /**
   * 把「目前回合」喊到數量＝p_total 上限後由當前玩家質疑（最小加碼序列）。
   *
   * challenge_bid 在同一交易內結束本回合並直接生成下一回合，故質疑後
   * 讀「最新兩列」比對：第一列＝新回合（僅遊戲結束時不存在），第二列＝
   * 已結束的本回合（round_end＋reveal＋resolve_note）。
   *
   * @param sessionId 局 ID
   * @param totalDice 場上存活骰子總數（喊到這個數必有人須質疑）
   * @returns nextRound＝新回合（遊戲結束時為 null）、endedRound＝已結束本回合
   */
  async function driveToChallenge(
    sessionId: number,
    totalDice: number,
  ): Promise<{ nextRound: RoundRow | null; endedRound: RoundRow }> {
    let round = await latestRound(sessionId);
    const roundNoBefore = round.round_no;
    while (round.status === 'bidding' && (round.bid_count ?? 0) < totalDice) {
      const prevCount = round.bid_count ?? 0;
      const prevFace = round.bid_face ?? 0;
      // 最小合法喊牌：有前喊時點數 +1；點數到 6 就數量 +1、點數回 1
      const count = round.bid_seq === 0 ? 1 : prevFace >= 6 ? prevCount + 1 : prevCount;
      const face = round.bid_seq === 0 ? 1 : prevFace >= 6 ? 1 : prevFace + 1;
      const token = round.current_seat === 1 ? tokenA : tokenB;
      await callRpc(token, 'submit_bid', {
        p_session_id: sessionId,
        p_count: count,
        p_face: face,
      });
      round = await latestRound(sessionId);
    }
    expect(round.status).toBe('bidding');
    const challengerToken = round.current_seat === 1 ? tokenA : tokenB;
    await callRpc(challengerToken, 'challenge_bid', { p_session_id: sessionId });

    const rows = await fetchRows(
      tokenA,
      'game_rounds',
      `session_id=eq.${sessionId}&order=round_no.desc&limit=2`,
    );
    const top = rows[0] as unknown as RoundRow;
    if (top.round_no === roundNoBefore) {
      // 未生成新回合＝本回合就是最後一回合（遊戲結束）
      expect(top.status).toBe('ended');
      return { nextRound: null, endedRound: top };
    }
    expect(top.round_no).toBe(roundNoBefore + 1);
    return { nextRound: top, endedRound: rows[1] as unknown as RoundRow };
  }

  test('RPC 完整對局：喊牌、加碼、質疑、開盅、淘汰與結算統計', async () => {
    test.setTimeout(180_000);
    const { sessionId } = await setupSession({ diceCount: 2, turnSeconds: 15 });

    // 起局：回合 1、seat 1 開喊、bid_seq 0、bidding
    const round = await latestRound(sessionId);
    expect(round.status).toBe('bidding');
    expect(round.current_seat).toBe(1);
    expect(round.bid_seq).toBe(0);
    expect(round.bid_count).toBeNull();
    const firstRoundNo = round.round_no;

    // 私有隔離：每人只看得到自己的骰子列（RLS），對方查不到本人以外的列
    const diceA = await fetchRows(
      tokenA,
      'game_player_dice',
      `session_id=eq.${sessionId}&round_no=eq.${round.round_no}&select=dice`,
    );
    const diceB = await fetchRows(
      tokenB,
      'game_player_dice',
      `session_id=eq.${sessionId}&round_no=eq.${round.round_no}&select=dice`,
    );
    expect(diceA).toHaveLength(1);
    expect(diceB).toHaveLength(1);
    const valuesA = (diceA[0] as { dice: number[] }).dice;
    const valuesB = (diceB[0] as { dice: number[] }).dice;
    expect(valuesA).toHaveLength(2);
    expect(valuesB).toHaveLength(2);
    for (const value of [...valuesA, ...valuesB]) {
      expect(Number.isInteger(value) && value >= 1 && value <= 6).toBe(true);
    }
    const asBSeesOthers = await fetchRows(
      tokenB,
      'game_player_dice',
      `session_id=eq.${sessionId}&select=user_id,dice`,
    );
    // 私有隔離的正確語意：B 能看到自己的骰子列，但絕不能出現 A 的列
    expect(asBSeesOthers.length).toBeGreaterThan(0);
    for (const row of asBSeesOthers) {
      expect((row as { user_id: string }).user_id).toBe(userBId);
    }
    expect((asBSeesOthers as Array<{ user_id: string }>).some((row) => row.user_id === userAId)).toBe(
      false,
    );

    // 第一輪：喊到「場上總數 4」而上限 → 質疑 → 開盅公開全員骰子；
    // 同交易生成下一回合，質疑後最新兩列依序為（新回合、已結束本回合）
    const { nextRound, endedRound } = await driveToChallenge(sessionId, 4);
    expect(endedRound.status).toBe('round_end');
    expect(endedRound.round_no).toBe(firstRoundNo);
    expect(endedRound.reveal).not.toBeNull();
    expect(endedRound.reveal!).toHaveLength(2);
    for (const entry of endedRound.reveal!) {
      expect(entry.dice).toHaveLength(2);
    }
    expect(endedRound.resolve_note).toContain('質疑');
    expect(endedRound.resolve_note).toContain('點');

    // 勝負落定：本輪失去 1 顆骰子的輸家（首輪還不會淘汰）
    const loserRows = await fetchRows(
      tokenA,
      'game_player_state',
      `session_id=eq.${sessionId}&select=user_id,seat,dice_left,eliminated&order=seat.asc`,
    );
    const loser = loserRows.find((row) => (row.dice_left as number) < 2);
    expect(loser).toBeTruthy();
    expect(loser!.eliminated).toBe(loser!.dice_left === 0);

    // 新回合：round_no+1、bid_seq 歸 0、bid 欄位清空、bidding、deadline 已設
    expect(nextRound).toBeTruthy();
    expect(nextRound!.round_no).toBe(firstRoundNo + 1);
    expect(nextRound!.status).toBe('bidding');
    expect(nextRound!.bid_seq).toBe(0);
    expect(nextRound!.bid_count).toBeNull();
    expect(nextRound!.bid_face).toBeNull();
    expect(Number.isNaN(Date.parse(nextRound!.deadline_at))).toBe(false);
    // current_seat＝輸家座位之後的第一個存活座位（無更高座位時繞回最小存活座位）
    const aliveSeats = loserRows
      .filter((row) => row.eliminated === false)
      .map((row) => row.seat as number)
      .sort((a, b) => a - b);
    const afterLoser = aliveSeats.filter((seat) => seat > (loser!.seat as number));
    const expectedSeat = afterLoser.length > 0 ? afterLoser[0] : aliveSeats[0];
    expect(nextRound!.current_seat).toBe(expectedSeat);

    // 新回合已重擲骰子（本人的骰子列長度＝本人剩餘骰數）
    const myState = loserRows.find((row) => row.user_id === userAId);
    const nextDiceA = await fetchRows(
      tokenA,
      'game_player_dice',
      `session_id=eq.${sessionId}&round_no=eq.${nextRound!.round_no}&select=dice`,
    );
    expect(nextDiceA).toHaveLength(1);
    expect(nextDiceA[0]?.dice as unknown[]).toHaveLength(myState!.dice_left as number);

    // 續打到分勝負：二人局每輪必有人失去 1 顆骰子，數輪內必然結束
    for (let guard = 0; guard < 12; guard += 1) {
      const state = await sessionOf(sessionId);
      if (state.winner) break;
      const roundNow = await latestRound(sessionId);
      expect(roundNow.status).toBe('bidding');
      const aliveRows = await fetchRows(
        tokenA,
        'game_player_state',
        `session_id=eq.${sessionId}&eliminated=eq.false&select=dice_left`,
      );
      const aliveTotal = aliveRows.reduce((sum, row) => sum + (row.dice_left as number), 0);
      await driveToChallenge(sessionId, aliveTotal);
    }

    // 局終：勝者確定、settled、輸家 dice_left 0 且非勝者
    const finalState = await sessionOf(sessionId);
    expect(finalState.winner).toBeTruthy();
    expect(finalState.settled_at).not.toBeNull();
    const stateRows = await fetchRows(
      tokenA,
      'game_player_state',
      `session_id=eq.${sessionId}&order=seat.asc`,
    );
    const eliminated = stateRows.filter((row) => row.eliminated === true);
    expect(eliminated).toHaveLength(1);
    expect(eliminated[0]?.dice_left).toBe(0);
    expect(finalState.winner).not.toBe(eliminated[0]?.user_id);

    // 統計：兩位玩家 games 皆 +1；勝者 wins 1、連勝 1；輸者連勝 0
    const stats = await fetchRows(
      tokenA,
      'player_statistics',
      `user_id=in.(${userAId},${userBId})`,
    );
    expect(stats).toHaveLength(2);
    const winnerStats = stats.find((row) => row.user_id === finalState.winner);
    const loserStats = stats.find((row) => row.user_id !== finalState.winner);
    expect(winnerStats?.wins).toBe(1);
    expect(winnerStats?.games).toBe(1);
    expect(winnerStats?.current_streak).toBe(1);
    expect(loserStats?.wins).toBe(0);
    expect(loserStats?.current_streak).toBe(0);
  });

  test('UI 對局：雙方倒數與私有骰子、喊牌同步、質疑開盅與新回合', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    /** 以 UI 完成登入，成功後回到首頁。 */
    const signIn = async (target: Page, email: string) => {
      await target.goto('/auth');
      await target.getByLabel('Email').fill(email);
      await target.getByLabel('密碼').fill(TEST_PASSWORD);
      await target.getByRole('button', { name: '登入', exact: true }).click();
      await expect(target).toHaveURL('/');
    };

    // A 登入並建立房間（骰子 2 顆縮短對局；思考 15 秒確保倒數可見）
    await signIn(page, USER_A.email);
    await page.goto('/games');
    await page.getByRole('button', { name: '建立新房間' }).click();
    await expect(page).toHaveURL(/\/games\/room\/[A-HJKMNP-Z2-9]{6}/);
    const roomId = roomIdFromUrl(page.url());
    // 逐步降低每人骰子數：update_room_settings 一次呼叫即確定新值，但
    // 快速連擊時三筆 RPC 平行執行、以「最後執行者」定值，可能以亂序
    // 收尾（例如停在 3）。每按一次就等大廳列同步到該值再按下一次，
    // 同時也驗證 game_rooms 的即時往返（事件同步）確實生效。
    await page.getByRole('button', { name: '遊戲設定（房主）' }).click();
    for (const expected of ['每人 4 顆骰子', '每人 3 顆骰子', '每人 2 顆骰子']) {
      await page.getByRole('button', { name: '減少每人骰子數' }).click();
      await expect(page.getByText(expected)).toBeVisible({ timeout: 10_000 });
    }

    // B 加入房間
    const contextB = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-TW',
    });
    const pageB = await contextB.newPage();
    pageB.on('pageerror', (error) => consoleErrors.push(`B: ${error.message}`));
    await signIn(pageB, USER_B.email);
    await pageB.goto('/games');
    await pageB.getByLabel('房間 ID').fill(roomId);
    await pageB.getByRole('button', { name: '加入', exact: true }).click();
    await expect(pageB).toHaveURL(new RegExp(`/games/room/${roomId}`));
    await expect(pageB.getByText('核心A')).toBeVisible({ timeout: 20_000 });

    // A 開局：A 立即導向 play 頁，B 端由訂閱同步跟進
    await page.getByRole('button', { name: '開始遊戲', exact: true }).click();
    await expect(page).toHaveURL(/\/games\/play\/\d+/);
    await expect(pageB).toHaveURL(/\/games\/play\/\d+/, { timeout: 20_000 });

    // 雙方都看到當前高亮玩家列與自己的骰子（2 顆大型骰面、值 1～6）
    // 私有隔離：雙方各只有一組「我的骰子」區，且值不必相同（各自擲骰）
    for (const target of [page, pageB]) {
      await expect(
        target.locator('[aria-label="回合剩餘秒數"]').filter({ hasText: /[1-9]/ }).first(),
      ).toBeVisible();
      await expect(target.getByRole('img', { name: /[1-6] 點/ })).toHaveCount(2);
      await expect(target.getByTestId('my-dice')).toHaveCount(1);
    }

    // A 喊牌（預設最小值 1 個 1 點），B 端 5 秒內同步顯示
    await page.getByRole('button', { name: '喊 1 個 1 點' }).click();
    await expect(pageB.getByText(/目前喊牌：1 個 1 點/)).toBeVisible({ timeout: 5_000 });

    // B 的操作區預設帶出「喊 2 個 1 點」（draft = 前喊數量 +1）並送出
    await pageB.getByRole('button', { name: '喊 2 個 1 點' }).click();
    await expect(page.getByText(/目前喊牌：2 個 1 點/)).toBeVisible({ timeout: 5_000 });

    // A 質疑：雙方 10 秒內看到開盅覆蓋（全員骰子與繁中結果描述）
    await page.getByRole('button', { name: '質疑上一筆' }).click();
    for (const target of [page, pageB]) {
      await expect(target.getByTestId('reveal-panel')).toBeVisible({ timeout: 10_000 });
      await expect(target.getByTestId('resolve-note')).toContainText('質疑');
    }
    // 開盅顯示數秒後自動關閉，並進入第 2 輪
    for (const target of [page, pageB]) {
      await expect(target.getByTestId('reveal-panel')).toBeHidden({ timeout: REVEAL_HIDE_TIMEOUT });
      await expect(target.getByText('第 2 輪')).toBeVisible();
    }

    expect(consoleErrors).toEqual([]);
    await contextB.close();
  });

  test('逾時代理：deadline 過後 sync_timeout 自動代喊並冪等', async () => {
    test.setTimeout(120_000);
    const { sessionId } = await setupSession({ diceCount: 2, turnSeconds: 5 });

    // 等 deadline 過（5 秒思考時間；輪詢公開表直到 now 超過 deadline）
    await expect
      .poll(async () => {
        const round = await latestRound(sessionId);
        return Date.parse(round.deadline_at) < Date.now();
      }, { timeout: 20_000 })
      .toBe(true);

    // 首喊逾時：自動代喊 (1,1)，game_actions 記 timeout_bid
    await callRpc(tokenA, 'sync_timeout', { p_session_id: sessionId });
    const round = await latestRound(sessionId);
    expect(round.bid_seq).toBe(1);
    expect(round.bid_count).toBe(1);
    expect(round.bid_face).toBe(1);
    const actions = await fetchRows(
      tokenA,
      'game_actions',
      `session_id=eq.${sessionId}&action=eq.timeout_bid&select=action,count,face`,
    );
    expect(actions).toHaveLength(1);

    // 冪等：再呼叫一次不會重複處理（bid_seq 維持 1、不重複記錄）
    await callRpc(tokenA, 'sync_timeout', { p_session_id: sessionId });
    const again = await latestRound(sessionId);
    expect(again.bid_seq).toBe(1);
    const actionsAgain = await fetchRows(
      tokenA,
      'game_actions',
      `session_id=eq.${sessionId}&action=eq.timeout_bid&select=action`,
    );
    expect(actionsAgain).toHaveLength(1);
  });
});
