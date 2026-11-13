/**
 * 手邊材料的雲端同步（Supabase user_pantry）。
 *
 * 運作原則：
 *   1. 樂觀更新。勾選／移除一律先改本地狀態與 localStorage（useOwnedIngredients
 *      的既有行為），再以差異（相對最近一次對齊的雲端集合）補送 user_pantry，
 *      雲端失敗不影響本地變更。
 *   2. 登入時合併。「聯集」合併本地與雲端，合併結果回寫雲端後，
 *      之後的雲端為準（本地持續寫一份作為未登入與降級的資料）。
 *   3. 未登入者完全不會觸發雲端行為，維持純 localStorage。
 *   4. 失敗恢復：每次變更失敗後 5 秒重試一次；仍失敗則等待下次
 *      變更、重新登入或重啟應用（INITIAL_SESSION 會再度觸發合併）。
 *
 * supabase-js 依舊以動態匯入載入，不會進入主 bundle。
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getAuthState, subscribeAuthState } from './authStore';
import {
  getOwnedSnapshot,
  replaceOwned,
  setOwnedCommitListener,
} from '../hooks/useOwnedIngredients';

/** 雲端寫入失敗後的重試等待（毫秒）。 */
export const PANTRY_SYNC_RETRY_DELAY_MS = 5000;

/** 同一項變更最多自動重試的次數（之後等下次變更、登入或重啟再補同步）。 */
const MAX_RETRY = 1;

/** 最近一次與雲端對齊的集合；null 代表尚未完成首次合併。 */
let cloudSet: ReadonlySet<string> | null = null;

/** 首次合併完成時的使用者 id；避免 display_name 等狀態更新重複觸發合併。 */
let syncedForUserId: string | null = null;

/** 目前是否有同步作業在執行（防止同時推多份差異）。 */
let inFlight = false;

/** 自動重試的計時器。 */
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 首次合併被擋（前一次同步還在飛）時的重試計時器。
 *
 * 與共用 retryTimer 分開：cloudSet 已就緒時，共用的分派會把
 * 新使用者的首次合併誤判成「推差異」，因此這裡獨立排「重跑合併」。
 */
let mergeRetryTimer: ReturnType<typeof setTimeout> | undefined;

/** 目前這項變已重試的次數。 */
let retryAttempts = 0;

/** 動態載入的用戶端 cache。 */
let clientCache: Promise<SupabaseClient | null> | null = null;

/** 是否已呼叫過 startPantrySync（避免重複註冊監聽）。 */
let started = false;

/**
 * 啟動手邊材料的雲端同步（整個應用只應呼叫一次；重複呼叫以第一次為準）。
 *
 * 監聽登入狀態（登入時合併）與本地清單變更（登入中推差異到雲端）。
 */
export function startPantrySync(): void {
  if (started) return;
  started = true;

  subscribeAuthState(() => {
    void handleAuthChange();
  });
  setOwnedCommitListener(handleCommit);
}

/**
 * 登入狀態變化時的反應：登入者合併雲端；登出者清空雲端對齊狀態。
 */
async function handleAuthChange(): Promise<void> {
  const { status, user } = getAuthState();
  if (status !== 'signedIn' || !user || !user.id) {
    clearRetryTimer();
    clearMergeRetryTimer();
    cloudSet = null;
    syncedForUserId = null;
    retryAttempts = 0;
    return;
  }
  await syncFromCloud(user);
}

/**
 * 動態載入並快取 Supabase 用戶端。
 *
 * @returns 未配置環境變數時回傳 null，同步作業直接結束
 */
async function loadClient(): Promise<SupabaseClient | null> {
  if (!clientCache) {
    clientCache = (async () => {
      const { getSupabaseClient } = await import('./supabase');
      return getSupabaseClient();
    })();
  }
  return clientCache;
}

/**
 * 登入時的首次合併：抓雲端清單，與本地聯集後回寫雲端再落到本地。
 *
 * @param user 目前登入的使用者
 */
async function syncFromCloud(user: User): Promise<void> {
  if (cloudSet !== null && syncedForUserId === user.id) return;
  if (inFlight) {
    // 前一次同步還在飛：新使用者的首次合併不能整個跳過，否則永不再補做。
    // 稍後直接重跑本使用者的合併；共用重試在此情境會因 cloudSet 已就緒
    // 而誤分派到「推差異」，故另立計時器。同時刻只排一個，避免堆疊。
    if (!mergeRetryTimer) {
      mergeRetryTimer = setTimeout(() => {
        mergeRetryTimer = undefined;
        void syncFromCloud(user);
      }, PANTRY_SYNC_RETRY_DELAY_MS);
    }
    return;
  }
  inFlight = true;
  try {
    const client = await loadClient();
    if (!client) {
      inFlight = false;
      return;
    }
    const cloud = await fetchCloudIds(client, user.id);
    const merged = new Set(cloud);
    for (const id of getOwnedSnapshot()) merged.add(id);
    const toAdd = [...merged].filter((id) => !cloud.has(id));
    if (toAdd.length > 0) await upsertIds(client, user.id, toAdd);
    cloudSet = merged;
    syncedForUserId = user.id;
    retryAttempts = 0;
    replaceOwned([...merged]);
  } catch (cause) {
    // 雲端失敗：本地不動，稍後重試一次；再失敗等下次啟動／登入補同步
    console.warn(
      `[pantrySync] 首次合併失敗，稍後重試：${cause instanceof Error ? cause.message : String(cause)}`,
    );
    scheduleRetry(user);
  } finally {
    inFlight = false;
  }
}

/**
 * 本地清單變更時的反應：登入中且已合併過雲端時，推差異到雲端。
 */
function handleCommit(): void {
  const { status, user } = getAuthState();
  if (status !== 'signedIn' || !user || !cloudSet || inFlight) return;
  retryAttempts = 0;
  clearRetryTimer();
  void pushDiff(user);
}

/**
 * 計算本地與雲端的差異並送出（樂觀更新後的補送）。
 *
 * @param user 目前登入的使用者
 */
async function pushDiff(user: User): Promise<void> {
  const base = cloudSet;
  if (!base) return;
  const local = getOwnedSnapshot();
  const toAdd = [...local].filter((id) => !base.has(id));
  const toRemove = [...base].filter((id) => !local.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) return;
  if (inFlight) return;

  inFlight = true;
  let succeeded = false;
  try {
    const client = await loadClient();
    if (!client) {
      inFlight = false;
      return;
    }
    if (toAdd.length > 0) await upsertIds(client, user.id, toAdd);
    if (toRemove.length > 0) await deleteIds(client, user.id, toRemove);
    cloudSet = new Set(local);
    succeeded = true;
  } catch (cause) {
    console.warn(
      `[pantrySync] 手邊材料推送失敗，稍後重試：${cause instanceof Error ? cause.message : String(cause)}`,
    );
    scheduleRetry(user);
  } finally {
    inFlight = false;
    // 進行中發生的後續變更，在這次送完後立刻補推（差異為空時自然停止）
    if (succeeded && hasPendingDiff(user)) void pushDiff(user);
  }
}

/**
 * 判斷目前是否還有未送出的差異。
 *
 * @param user 目前登入的使用者
 */
function hasPendingDiff(user: User): boolean {
  const { status, user: currentUser } = getAuthState();
  if (status !== 'signedIn' || !cloudSet || currentUser?.id !== user.id) return false;
  const local = getOwnedSnapshot();
  const cloud = cloudSet;
  if (local.size !== cloud.size) return true;
  for (const id of local) {
    if (!cloud.has(id)) return true;
  }
  return false;
}

/**
 * 安排一次重試（同一項變更最多重試 MAX_RETRY 次）。
 *
 * 依失敗的情境重跑對應作業：尚未合併過雲端時重跑合併，
 * 否則重跑差異推送。
 *
 * @param user 目前登入的使用者
 */
function scheduleRetry(user: User): void {
  if (retryTimer || retryAttempts >= MAX_RETRY) return;
  retryAttempts += 1;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void (cloudSet === null ? syncFromCloud(user) : pushDiff(user));
  }, PANTRY_SYNC_RETRY_DELAY_MS);
}

/** 取消已排程的重試。 */
function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
}

/** 取消已排程的首次合併重試。 */
function clearMergeRetryTimer(): void {
  if (mergeRetryTimer) {
    clearTimeout(mergeRetryTimer);
    mergeRetryTimer = undefined;
  }
}

/**
 * 抓取雲端 user_pantry 中的 id 清單。
 *
 * @param client Supabase 用戶端
 * @param userId 使用者 id
 * @returns 雲端已有的材料 id 集合
 */
async function fetchCloudIds(client: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from('user_pantry')
    .select('ingredient_id')
    .eq('user_id', userId);
  if (error) throw new Error(`手邊材料同步失敗：${error.message}`);
  const rows = (data ?? []) as { ingredient_id: string }[];
  return new Set(rows.map((row) => row.ingredient_id));
}

/**
 * 上傳差異列到 user_pantry。
 *
 * @param client Supabase 用戶端
 * @param userId 使用者 id
 * @param ids 要新增的材料 id
 */
async function upsertIds(client: SupabaseClient, userId: string, ids: string[]): Promise<void> {
  const rows = ids.map((id) => ({ user_id: userId, ingredient_id: id }));
  const { error } = await client.from('user_pantry').upsert(rows);
  if (error) throw new Error(`手邊材料同步失敗：${error.message}`);
}

/**
 * 從 user_pantry 刪除指定的材料列。
 *
 * @param client Supabase 用戶端
 * @param userId 使用者 id
 * @param ids 要移除的材料 id
 */
async function deleteIds(client: SupabaseClient, userId: string, ids: string[]): Promise<void> {
  const { error } = await client
    .from('user_pantry')
    .delete()
    .eq('user_id', userId)
    .in('ingredient_id', ids);
  if (error) throw new Error(`手邊材料同步失敗：${error.message}`);
}
