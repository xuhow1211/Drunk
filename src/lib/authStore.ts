/**
 * 登入狀態的共享存放區（authStore）。
 *
 * 以 supabase-js 的 auth 維護全站單一的登入狀態：
 * 各元件以 useSyncExternalStore 訂閱 useAuth()，看見同一份狀態；
 * supabase-js 仍以動態匯入載入（與 dataStore 相同），未配置 Supabase
 * 環境變數時不會進入主 bundle，會員功能整體隱藏。
 *
 * 顯示名稱的來源：profiles.display_name 為準；若資料庫缺值
 * （觸發器建檔與 display_name 寫入之間的時機差），改以註冊時
 * 存進 user_metadata 的名稱 upsert 補回 profiles。
 */
import { useSyncExternalStore } from 'react';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

/** 登入狀態的生命週期：初始化中、未登入、已登入。 */
export type AuthStatus = 'initializing' | 'signedOut' | 'signedIn';

/** 全站共用的登入狀態快照。 */
export interface AuthState {
  /** 目前處於哪個階段。 */
  status: AuthStatus;
  /** 已登入時的使用者；其餘為 null。 */
  user: User | null;
  /** 顯示名稱（profiles.display_name），未登入或尚未取得時為 null。 */
  displayName: string | null;
  /** Supabase 會員功能是否已配置可用。 */
  available: boolean;
  /** 特殊畫面情境標記：'recovery' 代表剛由密碼重設連結登入，畫面應顯示設定新密碼；其餘為 null。 */
  screen: 'recovery' | null;
}

/** 註冊結果：是否需要收信完成信箱驗證。 */
export interface SignUpResult {
  /** true 代表尚未產生 session，需收取確認信後重新登入。 */
  emailConfirmationRequired: boolean;
}

/** 訂閱者集合。 */
const listeners = new Set<() => void>();

/** 模組層級的狀態快照。 */
let authState: AuthState = {
  status: 'initializing',
  user: null,
  displayName: null,
  available: true,
  screen: null,
};

/** 已就緒的 Supabase 用戶端（startAuthLoad 內動態載入後快取）。 */
let clientRef: SupabaseClient | null = null;

/** 是否已啟動過初始化（整個應用只應呼叫一次）。 */
let started = false;

/** Supabase 錯誤代碼與說明文字的對照表。 */
const ERROR_TEXT: Record<string, string> = {
  invalid_credentials: '帳號或密碼不正確，請確認後再試。',
  email_not_confirmed: '信箱尚未完成驗證，請先收取確認信並完成驗證。',
  user_already_exists: '這個信箱已經註冊過，請改用登入。',
  user_not_found: '找不到這個信箱帳號，請確認輸入。',
  over_email_send_rate_limit: '寄信次數已達上限，請稍後再試。',
  weak_password: '密碼強度不足，請設定至少 6 個字元的密碼。',
};

/**
 * 把 supabase-js 的錯誤轉成面向使用者的繁中說明。
 *
 * 先比對官方錯誤代碼，再退回原始訊息文字，確保任一未知錯誤仍有畫面可顯示。
 *
 * @param cause 抓到的例外（supabase-js 的 AuthError 或其他）
 */
function describeAuthError(cause: unknown): string {
  const raw = cause as { code?: string; message?: string } | null;
  const code = raw?.code;
  if (code) {
    const text = ERROR_TEXT[code];
    if (text) return text;
  }
  const message = raw?.message ?? '';
  if (message) return message;
  return '會員操作失敗，請稍後再試。';
}

/** 讀取目前的登入狀態快照。 */
export function getAuthState(): AuthState {
  return authState;
}

/**
 * 訂閱登入狀態變化。
 *
 * @param listener 狀態變化時的通知回呼
 * @returns 取消訂閱的函式
 */
export function subscribeAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 更新狀態快照並通知所有訂閱者。 */
function setAuthState(next: AuthState): void {
  authState = next;
  for (const listener of listeners) listener();
}

/** 取得已就緒的用戶端；未配置會員功能時拋出可顯示的錯誤。 */
function requireClient(): SupabaseClient {
  if (!clientRef) throw new Error('會員功能尚未啟用，請確認 Supabase 設定。');
  return clientRef;
}

/**
 * 從 user 取得註冊時留下的顯示名稱（user_metadata.display_name）。
 *
 * @param user 目前登入的使用者
 */
function metadataDisplayName(user: User): string | null {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const value = meta?.display_name;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * 以 upsert 把註冊時的顯示名稱補回 profiles（on conflict 更新既有列）。
 *
 * 觸發器與寫入之間的競態下，profiles 列已由觸發器建立，
 * upsert 走衝突更新路徑；列不存在時 insert 會被 RLS 擋下，
 * 靜默忽略即可，下次登入會再嘗試一次。
 *
 * @param client Supabase 用戶端
 * @param user 目前登入的使用者
 * @param name 要補上的顯示名稱
 */
async function backfillDisplayName(
  client: SupabaseClient,
  user: User,
  name: string,
): Promise<void> {
  const { error } = await client
    .from('profiles')
    .upsert({ id: user.id, display_name: name }, { onConflict: 'id' });
  if (error) return;
  setAuthState({ ...authState, displayName: name });
}

/**
 * 讀取 profiles.display_name，缺值時以註冊名稱補寫。
 *
 * 讀取失敗不阻擋登入，介面先顯示註冊時的 metadata 名稱。
 *
 * @param user 目前登入的使用者
 */
async function loadDisplayName(user: User): Promise<void> {
  const client = clientRef;
  if (!client) return;
  const { data, error } = await client
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return;
  const stored = data?.display_name ?? null;
  if (stored) {
    setAuthState({ ...authState, displayName: stored });
    return;
  }
  const meta = metadataDisplayName(user);
  if (meta) await backfillDisplayName(client, user, meta);
}

/**
 * 回應 auth 狀態事件，落成模組層級的快照。
 *
 * @param event supabase-js 的事件名稱
 * @param session 目前的 session（登入中時不為 null）
 */
function handleAuthEvent(event: string, session: Session | null): void {
  if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
    setAuthState({
      status: 'signedOut',
      user: null,
      displayName: null,
      available: true,
      screen: null,
    });
    return;
  }
  const user = session?.user ?? null;
  if (!user) return;
  // 密碼重設連結登入：標記恢復情境，畫面改為設定新密碼。
  // 同一使用者的其他重複事件（INITIAL_SESSION、TOKEN_REFRESHED 等）才會被
  // 下面的去重條件略過；恢復事件需即時切換畫面，故放在去重之前。
  if (event === 'PASSWORD_RECOVERY') {
    setAuthState({
      status: 'signedIn',
      user,
      displayName: metadataDisplayName(user),
      available: true,
      screen: 'recovery',
    });
    void loadDisplayName(user);
    return;
  }
  // 同一使用者的重複事件（INITIAL_SESSION、TOKEN_REFRESHED 等）不重複處理
  if (authState.status === 'signedIn' && authState.user?.id === user.id) return;
  setAuthState({
    status: 'signedIn',
    user,
    displayName: metadataDisplayName(user),
    available: true,
    screen: null,
  });
  void loadDisplayName(user);
}

/**
 * 啟動登入狀態初始化（整個應用只應呼叫一次；重複呼叫以第一次為準）。
 *
 * Supabase 未配置（環境變數缺一即同）時直接標記為未登入與
 * 會員功能未啟用，介面隱藏入口；supabase-js 以動態匯入載入。
 */
export function startAuthLoad(): void {
  if (started) return;
  started = true;
  void initializeAuth();
}

/** 初始化的實作：建立用戶端、掛上事件監聽。 */
async function initializeAuth(): Promise<void> {
  const { getSupabaseClient } = await import('./supabase');
  const client = getSupabaseClient();
  if (!client) {
    clientRef = null;
    setAuthState({
      status: 'signedOut',
      user: null,
      displayName: null,
      available: false,
      screen: null,
    });
    return;
  }
  clientRef = client;
  client.auth.onAuthStateChange((event, session) => handleAuthEvent(event, session));
  const { data } = await client.auth.getSession();
  if (!data?.session) {
    setAuthState({
      status: 'signedOut',
      user: null,
      displayName: null,
      available: true,
      screen: null,
    });
    return;
  }
  handleAuthEvent('SIGNED_IN', data.session);
}

/**
 * 會員註冊：以 Email 與密碼建立帳號，並把顯示名稱存進 user_metadata。
 *
 * 顯示名稱會在首次登入（session 建立）時補寫進 profiles；
 * 需要 Email 驗證的專案設定下，註冊後回傳需收信，尚未產生 session。
 *
 * @param email 信箱
 * @param password 密碼（至少 6 字元，由資料庫設定）
 * @param displayName 使用者自訂的顯示名稱
 * @returns 是否需要收信完成驗證
 */
export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<SignUpResult> {
  const client = requireClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw new Error(describeAuthError(error));
  return { emailConfirmationRequired: data.session === null };
}

/** 會員登入：以 Email 與密碼換取 session，事件系統會接手更新狀態。 */
export async function signIn(email: string, password: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(describeAuthError(error));
}

/** 登出目前的裝置；事件系統會接手清空狀態。 */
export async function signOut(): Promise<void> {
  const client = requireClient();
  await client.auth.signOut();
}

/**
 * 寄送密碼重設信到指定信箱。
 *
 * 信中的連結導回 /auth?mode=reset-password，由 supabase-js 從網址
 * 取得 session 後觸發 PASSWORD_RECOVERY，畫面再切到設定新密碼。
 *
 * @param email 註冊時使用的信箱
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth?mode=reset-password`,
  });
  if (error) throw new Error(describeAuthError(error));
}

/**
 * 以目前登入的 session 設定新密碼（密碼重設連結登入後呼叫）。
 *
 * @param newPassword 使用者輸入的新密碼
 */
export async function updatePassword(newPassword: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw new Error(describeAuthError(error));
}

/** 清除「設定新密碼」畫面的情境標記（設定完成後呼叫，回復一般登入畫面語意）。 */
export function clearRecoveryScreen(): void {
  if (authState.screen !== 'recovery') return;
  setAuthState({ ...authState, screen: null });
}

/**
 * 以 React Hook 取得全站共用的登入狀態。
 *
 * 所有訂閱的元件都會看到同一份快照，Nav 與會員頁不會各自為政。
 */
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribeAuthState, getAuthState, getAuthState);
}
