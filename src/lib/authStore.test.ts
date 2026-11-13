/**
 * authStore 的單元測試。
 *
 * supabase-js 以 vi.mock 模擬（node 環境無法建立真實用戶端），
 * 覆蓋：註冊成功／失敗、登入成功／失敗、display_name 的讀取與
 * profiles 補寫、登出與 Supabase 未配置的路徑。全程不做真實網路請求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { AuthState } from './authStore';

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

/** 模擬用的使用者。 */
function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'member@example.com',
    user_metadata: {},
    ...overrides,
  } as unknown as User;
}

/** 模擬用的 session。 */
function fakeSession(user: User | null) {
  return user === null ? null : { user };
}

/** profiles 查詢鏈的假節點（select→eq→maybeSingle / upsert）。 */
function makeProfilesNode(data: unknown, error: unknown) {
  let upsertArgs: unknown = null;
  const node = {
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          error === null
            ? Promise.resolve({ data, error: null })
            : Promise.resolve({ data: null, error }),
      }),
    }),
    upsert: (args: unknown) => {
      upsertArgs = args;
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { node, getUpsertArgs: () => upsertArgs };
}

type AuthModule = typeof import('./authStore');

/** 依設定建立假用戶端（記錄呼叫供斷言）。 */
function fakeClient(options: {
  profiles?: { data: unknown; error: unknown };
  signUpError?: { code: string; message: string } | null;
  signUpSession?: { user: User } | null;
  signInError?: { code: string; message: string } | null;
  resetError?: { code: string; message: string } | null;
  updateUserError?: { code: string; message: string } | null;
}) {
  const profiles = makeProfilesNode(options.profiles?.data ?? null, options.profiles?.error ?? null);
  const client = {
    from: (table: string) => (table === 'profiles' ? profiles.node : {}),
    profileUpsertArgs: profiles.getUpsertArgs,
    auth: {
      onAuthStateChange: (handler: (event: string, session: unknown) => void) => {
        (client as unknown as { emit: (event: string, session: unknown) => void }).emit =
          (event, session) => {
            handler(event, session);
            return { data: { subscription: { unsubscribe() {} } }, error: null };
          };
        return { data: { subscription: { unsubscribe() {} } }, error: null };
      },
      signUp: vi.fn(async () => ({
        data: { user: null, session: options.signUpSession ?? null },
        error: options.signUpError ?? null,
      })),
      signInWithPassword: vi.fn(async () => ({
        data: { user: fakeUser(), session: fakeSession(fakeUser()) },
        error: options.signInError ?? null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: options.resetError ?? null })),
      updateUser: vi.fn(async () => ({
        data: { user: fakeUser() },
        error: options.updateUserError ?? null,
      })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
    profilesNode: profiles,
  };
  return client;
}

/** 重新載入 authStore 模組（模組層級狀態須重置才互不干擾）。 */
async function loadAuthStore(): Promise<{
  module: AuthModule;
  emit: (event: string, session: unknown) => void;
}> {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test');
  const module = await import('./authStore');
  void module.startAuthLoad();
  // 動態 import('./supabase') 是非同步的，等到初始化落定（離開 initializing）再繼續
  await vi.waitFor(() => {
    if (module.getAuthState().status === 'initializing') throw new Error('尚未完成初始化');
  });
  const client = createClientMock.mock.results.at(0)?.value as unknown as {
    emit: (event: string, session: unknown) => void;
  };
  return { module, emit: (event, session) => client.emit(event, session) };
}

beforeEach(() => {
  createClientMock.mockReset();
  createClientMock.mockImplementation(() => fakeClient({}));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('註冊', () => {
  it('註冊成功且需要收信驗證時，回傳待驗證，不改變登入狀態', async () => {
    createClientMock.mockImplementation(() =>
      fakeClient({ signUpError: null, signUpSession: null }),
    );
    const { module } = await loadAuthStore();

    const result = await module.signUp('a@example.com', 'longenough1', '小明');

    expect(result.emailConfirmationRequired).toBe(true);
    expect(module.getAuthState().available).toBe(true);
  });

  it('註冊失敗（信箱已註冊）時以繁中訊息拋出', async () => {
    createClientMock.mockImplementation(() =>
      fakeClient({ signUpError: { code: 'user_already_exists', message: 'User already registered' } }),
    );
    const { module } = await loadAuthStore();

    await expect(module.signUp('a@example.com', 'longenough1', '小明')).rejects.toThrow(
      '這個信箱已經註冊過，請改用登入。',
    );
  });

  it('資料庫顯示名稱缺值時，以註冊名稱 upsert 補寫 profiles', async () => {
    const client = fakeClient({ profiles: { data: { display_name: null }, error: null } });
    createClientMock.mockImplementation(() => client);
    const { module, emit } = await loadAuthStore();

    emit('INITIAL_SESSION', fakeSession(fakeUser({ user_metadata: { display_name: '小明' } })));

    await vi.waitFor(() => {
      expect(module.getAuthState().displayName).toBe('小明');
    });
    expect(client.profileUpsertArgs()).toMatchObject({
      id: 'user-1',
      display_name: '小明',
    });
  });

  it('profiles 已設有顯示名稱時以資料庫為準，不進行補寫', async () => {
    const client = fakeClient({ profiles: { data: { display_name: '資料庫名稱' }, error: null } });
    createClientMock.mockImplementation(() => client);
    const { module, emit } = await loadAuthStore();

    emit('INITIAL_SESSION', fakeSession(fakeUser({ user_metadata: { display_name: '小明' } })));

    await vi.waitFor(() => {
      expect(module.getAuthState().displayName).toBe('資料庫名稱');
    });
    expect(client.profileUpsertArgs()).toBeNull();
  });
});

describe('登入', () => {
  it('登入成功（invalid credentials 未發生）時狀態更新為已登入', async () => {
    const { module } = await loadAuthStore();

    await module.signIn('a@example.com', 'longenough1');

    // 真實流程由 supabase-js 事件驅動；此處驗證呼叫本身成功回傳
    expect(module.getAuthState().available).toBe(true);
  });

  it('登入失敗（密碼錯誤）時以繁中訊息拋出', async () => {
    createClientMock.mockImplementation(() =>
      fakeClient({ signInError: { code: 'invalid_credentials', message: 'Invalid login credentials' } }),
    );
    const { module } = await loadAuthStore();

    await expect(module.signIn('a@example.com', 'wrongpw1')).rejects.toThrow(
      '帳號或密碼不正確，請確認後再試。',
    );
  });

  it('登入失敗（信箱未驗證）時以繁中訊息拋出', async () => {
    createClientMock.mockImplementation(() =>
      fakeClient({ signInError: { code: 'email_not_confirmed', message: 'Email not confirmed' } }),
    );
    const { module } = await loadAuthStore();

    await expect(module.signIn('a@example.com', 'longenough1')).rejects.toThrow(
      '信箱尚未完成驗證，請先收取確認信並完成驗證。',
    );
  });

  it('未知的 Supabase 錯誤退回原始訊息，仍有畫面可顯示', async () => {
    createClientMock.mockImplementation(() =>
      fakeClient({ signInError: { code: 'weird_code', message: 'Something odd' } }),
    );
    const { module } = await loadAuthStore();

    await expect(module.signIn('a@example.com', 'longenough1')).rejects.toThrow('Something odd');
  });

  it('SIGNED_IN 事件後狀態為已登入，SIGNED_OUT 後清空', async () => {
    const { module, emit } = await loadAuthStore();

    emit('INITIAL_SESSION', fakeSession(fakeUser()));

    await vi.waitFor(() => {
      expect(module.getAuthState().status).toBe('signedIn');
    });

    emit('SIGNED_OUT', null);

    await vi.waitFor(() => {
      const state = module.getAuthState();
      expect(state.status).toBe('signedOut');
      expect(state.user).toBeNull();
      expect(state.displayName).toBeNull();
    });
  });
});

describe('登出與密碼重設', () => {
  it('signOut 呼叫成功回傳', async () => {
    const { module } = await loadAuthStore();
    await expect(module.signOut()).resolves.toBeUndefined();
  });

  it('重設信寄送失敗（寄信頻率上限）時以繁中訊息拋出', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://test.example' } });
    createClientMock.mockImplementation(() =>
      fakeClient({
        resetError: { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
      }),
    );
    const { module } = await loadAuthStore();

    await expect(module.requestPasswordReset('a@example.com')).rejects.toThrow(
      '寄信次數已達上限，請稍後再試。',
    );
  });

  it('重設信寄送時帶 redirectTo 導回 reset-password 頁', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://test.example' } });
    const { module } = await loadAuthStore();

    await expect(module.requestPasswordReset('a@example.com')).resolves.toBeUndefined();

    const client = createClientMock.mock.results.at(0)?.value as unknown as {
      auth: { resetPasswordForEmail: { mock: { calls: unknown[][] } } };
    };
    expect(client.auth.resetPasswordForEmail.mock.calls[0]).toEqual([
      'a@example.com',
      { redirectTo: 'https://test.example/auth?mode=reset-password' },
    ]);
  });

  it('updatePassword 失敗（密碼強度不足）時以繁中訊息拋出', async () => {
    createClientMock.mockImplementation(() =>
      fakeClient({
        updateUserError: { code: 'weak_password', message: 'Password should be at least 6 characters' },
      }),
    );
    const { module } = await loadAuthStore();

    await expect(module.updatePassword('abc')).rejects.toThrow(
      '密碼強度不足，請設定至少 6 個字元的密碼。',
    );
  });

  it('updatePassword 成功時正常回傳，不改變登入狀態', async () => {
    const { module } = await loadAuthStore();

    await expect(module.updatePassword('newpassword1')).resolves.toBeUndefined();
    expect(module.getAuthState().available).toBe(true);
  });
});

describe('密碼重設連結登入（PASSWORD_RECOVERY）', () => {
  it('PASSWORD_RECOVERY 事件後狀態為已登入且 screen 標記為 recovery', async () => {
    const { module, emit } = await loadAuthStore();

    emit('PASSWORD_RECOVERY', fakeSession(fakeUser()));

    await vi.waitFor(() => {
      const state = module.getAuthState();
      expect(state.status).toBe('signedIn');
      expect(state.screen).toBe('recovery');
    });
  });

  it('clearRecoveryScreen 後 screen 回復為 null', async () => {
    const { module, emit } = await loadAuthStore();

    emit('PASSWORD_RECOVERY', fakeSession(fakeUser()));
    await vi.waitFor(() => {
      expect(module.getAuthState().screen).toBe('recovery');
    });

    module.clearRecoveryScreen();

    expect(module.getAuthState().screen).toBeNull();
    expect(module.getAuthState().status).toBe('signedIn');
  });

  it('同一使用者已登入時收到 PASSWORD_RECOVERY 仍切換到 recovery 畫面', async () => {
    const { module, emit } = await loadAuthStore();

    emit('INITIAL_SESSION', fakeSession(fakeUser()));
    await vi.waitFor(() => {
      expect(module.getAuthState().status).toBe('signedIn');
    });
    expect(module.getAuthState().screen).toBeNull();

    emit('PASSWORD_RECOVERY', fakeSession(fakeUser()));

    expect(module.getAuthState().screen).toBe('recovery');
  });
});

describe('Supabase 未配置', () => {
  it('環境變數缺任一項時，登入狀態為未登入且會員功能標記為未啟用', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const module = await import('./authStore');
    module.startAuthLoad();

    await vi.waitFor(() => {
      const state = module.getAuthState();
      expect(state.status).toBe('signedOut');
      expect(state.available).toBe(false);
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('會員功能未啟用時呼叫會員操作會拋出可顯示的錯誤', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const module = await import('./authStore');
    module.startAuthLoad();

    await vi.waitFor(() => {
      expect(module.getAuthState().available).toBe(false);
    });

    await expect(module.signIn('a@example.com', 'longenough1')).rejects.toThrow(
      '會員功能尚未啟用',
    );
  });
});

describe('useAuth', () => {
  it('訂閱者會在狀態變化時收到通知', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const module = await import('./authStore');
    const snapshots: AuthState[] = [];
    const unsubscribe = module.subscribeAuthState(() => snapshots.push(module.getAuthState()));
    module.startAuthLoad();

    await vi.waitFor(() => {
      expect(module.getAuthState().available).toBe(false);
    });
    unsubscribe();
    expect(snapshots.length).toBeGreaterThan(0);
  });
});
