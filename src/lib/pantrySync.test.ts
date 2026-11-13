/**
 * 手邊材料雲端同步（pantrySync）的單元測試。
 *
 * authStore 以 vi.mock 模擬（可控登入狀態），supabase-js 以 vi.mock 模擬，
 * 驗證：未登入時不打雲端、登入時聯集合併並回寫、登入後差異推送（新增／刪除）、
 * 失敗後 5 秒重試一次、登出後回到純 localStorage 的行為。全程不做真實網路請求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANTRY_SYNC_RETRY_DELAY_MS } from './pantrySync';

const createClientMock = vi.hoisted(() => vi.fn());

/** authStore 的模擬狀態（由測試直接改寫後通知監聽者）。 */
const authStateRef = vi.hoisted(() => ({
  current: { status: 'signedOut', user: null as { id: string } | null },
}));

/** authStore 的模擬訂閱者清單。 */
const authListeners = vi.hoisted(() => ({
  list: [] as (() => void)[],
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

vi.mock('./authStore', () => ({
  getAuthState: () => authStateRef.current,
  subscribeAuthState: (listener: () => void) => {
    authListeners.list.push(listener);
    return () => {
      authListeners.list = authListeners.list.filter((item) => item !== listener);
    };
  },
}));

/** 模擬的 localStorage。 */
class FakeStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

interface PantryNode {
  calls: {
    upserts: { user_id: string; ingredient_id: string }[][];
    deletes: string[][];
  };
  fail: {
    fetchError: { message: string } | null;
    upsertError: { message: string } | null;
    deleteError: { message: string } | null;
  };
  /** 藉由改 pantryIds 可動態調整 select 回傳的雲端內容。 */
  pantryIds: string[];
}

/** user_pantry 查詢鏈的假節點（記錄呼叫，可指定錯誤）。 */
function makePantryNode(pantryIds: string[], fetchError: { message: string } | null): PantryNode {
  const node: PantryNode = {
    calls: { upserts: [], deletes: [] },
    fail: { fetchError, upsertError: null, deleteError: null },
    pantryIds,
  };
  return node;
}

/** 把 pantry 節點裝到假用戶端上（同時供 mock 的回呼使用）。 */
function attachClient(node: PantryNode) {
  createClientMock.mockImplementation(() => ({
    from: (table: string) => (table === 'user_pantry' ? pantryTable(node) : {}),
  }));
}

/** 依節點產生 user_pantry 的查詢鏈。 */
function pantryTable(node: PantryNode) {
  return {
    select: () => ({
      eq: () =>
        node.fail.fetchError !== null
          ? Promise.resolve({ data: null, error: node.fail.fetchError })
          : Promise.resolve({
              data: node.pantryIds.map((id) => ({ ingredient_id: id })),
              error: null,
            }),
    }),
    upsert: (rows: { user_id: string; ingredient_id: string }[]) => {
      node.calls.upserts.push(rows);
      return node.fail.upsertError
        ? Promise.resolve({ data: null, error: node.fail.upsertError })
        : Promise.resolve({ data: null, error: null });
    },
    delete: () => ({
      eq: () => ({
        in: (_column: string, ids: string[]) => {
          node.calls.deletes.push(ids);
          return node.fail.deleteError
            ? Promise.resolve({ data: null, error: node.fail.deleteError })
            : Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  };
}

type OwnedModule = typeof import('../hooks/useOwnedIngredients');

let storage: FakeStorage;

/**
 * 以指定 localStorage 內容重新載入受測模組群並啟動同步。
 *
 * useOwnedIngredients 在 import 時就讀 localStorage，因此每次都要重導入。
 *
 * @param storedIds 預先存在 localStorage 的手邊材料
 * @param node 登記的 user_pantry 假節點
 */
async function loadModules(storedIds?: string[], node?: PantryNode) {
  vi.resetModules();
  storage = new FakeStorage();
  if (storedIds) storage.setItem('join-owned-ingredients', JSON.stringify(storedIds));
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
  authStateRef.current = { status: 'signedOut', user: null };
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test');
  if (node) attachClient(node);
  const owned = (await import('../hooks/useOwnedIngredients')) as OwnedModule;
  // 須以重導入後的 pantrySync 呼叫（vi.resetModules 也重置其 started 旗標）
  const sync = await import('./pantrySync');
  sync.startPantrySync();
  return { owned };
}

/** 讀出目前 localStorage 的 id 陣列。 */
function storedRawIds(): string[] {
  const raw = storage.getItem('join-owned-ingredients');
  return raw === null ? [] : (JSON.parse(raw) as string[]);
}

/** 讀出目前 localStorage 的 id（排序後，聯集不保證特定順序）。 */
function sortedStoredIds(): string[] {
  return [...storedRawIds()].sort();
}

/** 把狀態切到指定使用者登入中，並通知監聽者。 */
function signInAs(userId: string) {
  authStateRef.current = { status: 'signedIn', user: { id: userId } };
  for (const listener of [...authListeners.list]) listener();
}

/** 把狀態切到登出，並通知監聽者。 */
function signOutNow() {
  authStateRef.current = { status: 'signedOut', user: null };
  for (const listener of [...authListeners.list]) listener();
}

beforeEach(() => {
  createClientMock.mockReset();
  // 清掉前一個測試登記的監聽者，避免舊模組實例接到通知造成干擾
  authListeners.list.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('未登入', () => {
  it('勾選只寫 localStorage，完全不建立 Supabase 用戶端', async () => {
    await loadModules();

    (await import('../hooks/useOwnedIngredients')).toggleOwned('gin');
    await vi.waitFor(() => {
      expect(storedRawIds()).toEqual(['gin']);
    });

    expect(createClientMock).not.toHaveBeenCalled();
  });
});

describe('登入時的合併', () => {
  it('本地與雲端取聯集：本地 gin、雲端 campari 時合併為兩項並回寫雲端', async () => {
    const node = makePantryNode(['campari'], null);
    const { owned } = await loadModules(['gin'], node);

    signInAs('user-1');
    await vi.waitFor(() => {
      expect(sortedStoredIds()).toEqual(['campari', 'gin']);
    });

    expect(owned.isOwned('gin')).toBe(true);
    expect(owned.isOwned('campari')).toBe(true);
    expect(node.calls.upserts).toEqual([[{ user_id: 'user-1', ingredient_id: 'gin' }]]);
  });

  it('聯集回寫只補差異列，雲端已有的項目不上傳也不刪除', async () => {
    const node = makePantryNode(['gin', 'campari'], null);
    await loadModules(['gin', 'vermouth-red'], node);

    signInAs('user-1');
    // 收斂點：合併完成（聯集落袋）後才斷言補送的差異列
    await vi.waitFor(() => {
      expect(sortedStoredIds()).toEqual(['campari', 'gin', 'vermouth-red']);
    });

    expect(node.calls.upserts).toEqual([[{ user_id: 'user-1', ingredient_id: 'vermouth-red' }]]);
    expect(node.calls.deletes).toEqual([]);
  });

  it('雲端抓取失敗時本地清單照舊，5 秒後重試成功才完成合併', async () => {
    const node = makePantryNode(['campari'], { message: '模擬失敗' });
    const { owned } = await loadModules(['gin'], node);
    vi.useFakeTimers();

    signInAs('user-1');
    await vi.waitFor(() => {
      expect(node.calls.upserts).toHaveLength(0);
    });
    expect(owned.isOwned('gin')).toBe(true);
    expect(owned.isOwned('campari')).toBe(false);
    expect(storedRawIds()).toEqual(['gin']);

    node.fail.fetchError = null;
    node.pantryIds = ['campari'];
    await vi.advanceTimersByTimeAsync(PANTRY_SYNC_RETRY_DELAY_MS + 0);
    await vi.waitFor(() => {
      expect(sortedStoredIds()).toEqual(['campari', 'gin']);
    });
  });

  it('前一次合併仍在飛時登入另一使用者，改為排重試補做該使用者的首次合併', async () => {
    // 自建假節點：第一次查詢（使用者 1）以閘門卡住，模擬「合併仍在飛」
    const upserts: { user_id: string; ingredient_id: string }[][] = [];
    let fetchCount = 0;
    let releaseFirst!: (result: { data: { ingredient_id: string }[]; error: null }) => void;
    const firstGate = new Promise<{ data: { ingredient_id: string }[]; error: null }>(
      (resolve) => {
        releaseFirst = resolve;
      },
    );
    await loadModules(['gin']);
    createClientMock.mockImplementation(() => ({
      from: (table: string) =>
        table === 'user_pantry'
          ? {
              select: () => ({
                eq: () => {
                  fetchCount += 1;
                  // 查詢一：使用者 1 的首次合併；查詢二：使用者 2 的重試合併
                  return fetchCount === 1
                    ? firstGate
                    : Promise.resolve({ data: [], error: null });
                },
              }),
              upsert: (rows: { user_id: string; ingredient_id: string }[]) => {
                upserts.push(rows);
                return Promise.resolve({ data: null, error: null });
              },
              delete: () => ({
                eq: () => ({
                  in: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }
          : {},
    }));
    vi.useFakeTimers();

    // 使用者 1 的合併卡在飛行中時，使用者 2 同時登入；
    // 若此情境被直接跳過，使用者 2 的首次合併將永遠不會補做
    signInAs('user-1');
    signInAs('user-2');

    // 放行使用者 1 的查詢：雲端有 campari，聯集後補上傳 gin
    releaseFirst({ data: [{ ingredient_id: 'campari' }], error: null });
    await vi.waitFor(() => {
      expect(sortedStoredIds()).toEqual(['campari', 'gin']);
    });

    // 重試時間到：使用者 2 的首次合併補做，雲端（空）差異需以使用者 2 的名義上傳
    await vi.advanceTimersByTimeAsync(PANTRY_SYNC_RETRY_DELAY_MS);
    await vi.waitFor(() => {
      expect(upserts.length).toBeGreaterThanOrEqual(2);
      expect(upserts[1]).toEqual([
        { user_id: 'user-2', ingredient_id: 'campari' },
        { user_id: 'user-2', ingredient_id: 'gin' },
      ]);
    });
  });
});

describe('登入後的差異推送', () => {
  it('新增材料先落本地，雲端 upsert 帶 user_id 與材料 id', async () => {
    const node = makePantryNode(['campari'], null);
    const { owned } = await loadModules(['gin'], node);

    signInAs('user-1');
    await vi.waitFor(() => {
      expect(node.calls.upserts).toHaveLength(1);
    });
    owned.toggleOwned('lime');
    await vi.waitFor(() => {
      expect(node.calls.upserts).toHaveLength(2);
    });

    expect(sortedStoredIds()).toEqual(['campari', 'gin', 'lime']);
    expect(node.calls.upserts[1]).toEqual([{ user_id: 'user-1', ingredient_id: 'lime' }]);
  });

  it('移除材料時雲端以 in 條件刪除指定的列', async () => {
    const node = makePantryNode(['gin', 'campari'], null);
    const { owned } = await loadModules(['gin'], node);

    signInAs('user-1');
    // 收斂點：首次合併落袋（雲端的 campari 進入本地）後才做移除
    await vi.waitFor(() => {
      expect(sortedStoredIds()).toEqual(['campari', 'gin']);
    });
    owned.removeManyOwned(['campari']);
    await vi.waitFor(() => {
      expect(node.calls.deletes).toEqual([['campari']]);
    });

    expect(sortedStoredIds()).toEqual(['gin']);
  });

  it('雲端寫入失敗時本地變更不丟失，5 秒重試一次，再失敗則停止自動重試', async () => {
    const node = makePantryNode([], null);
    const { owned } = await loadModules([], node);
    vi.useFakeTimers();

    signInAs('user-1');
    await vi.waitFor(() => {
      expect(owned.isOwned('campari')).toBe(false);
    });
    node.fail.upsertError = { message: '模擬失敗' };
    owned.toggleOwned('gin');
    await vi.waitFor(() => {
      expect(node.calls.upserts).toHaveLength(1);
    });
    expect(sortedStoredIds()).toEqual(['gin']);

    // 第一次重試仍失敗
    await vi.advanceTimersByTimeAsync(PANTRY_SYNC_RETRY_DELAY_MS);
    await vi.waitFor(() => {
      expect(node.calls.upserts).toHaveLength(2);
    });
    expect(sortedStoredIds()).toEqual(['gin']);

    // 不再自動重試：過更久也不會有新的 upsert
    await vi.advanceTimersByTimeAsync(PANTRY_SYNC_RETRY_DELAY_MS * 3);
    await vi.waitFor(() => {
      expect(owned.isOwned('gin')).toBe(true);
    });
    expect(node.calls.upserts).toHaveLength(2);
    expect(sortedStoredIds()).toEqual(['gin']);
  });

  it('同步失敗時輸出 console.warn（首次合併與差異推送皆然），供診斷', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const node = makePantryNode([], { message: '模擬失敗' });
    const { owned } = await loadModules(['gin'], node);
    vi.useFakeTimers();

    signInAs('user-1');
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/首次合併失敗/));
    });

    // 重試成功完成合併後，差異推送失敗同樣要有 warn
    node.fail.fetchError = null;
    node.pantryIds = [];
    await vi.advanceTimersByTimeAsync(PANTRY_SYNC_RETRY_DELAY_MS);
    await vi.waitFor(() => {
      expect(node.calls.upserts).toHaveLength(1);
    });

    node.fail.upsertError = { message: '模擬推送失敗' };
    owned.toggleOwned('lime');
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/推送失敗/));
    });
    warnSpy.mockRestore();
  });
});

describe('登出後', () => {
  it('本地清單保留，且變更不再打到雲端；下次登入再次合併回寫', async () => {
    const node = makePantryNode(['campari'], null);
    const { owned } = await loadModules(['gin'], node);

    signInAs('user-1');
    await vi.waitFor(() => {
      expect(sortedStoredIds()).toEqual(['campari', 'gin']);
    });
    signOutNow();
    await vi.waitFor(() => {
      expect(owned.isOwned('gin')).toBe(true);
    });
    owned.toggleOwned('lime');
    await vi.waitFor(() => {
      expect(sortedStoredIds()).toEqual(['campari', 'gin', 'lime']);
    });
    // 登出後的變更不送雲端
    expect(node.calls.upserts).toEqual([[{ user_id: 'user-1', ingredient_id: 'gin' }]]);

    // 再次登入：與雲端清單聯集，並把登出期間的本地變更補上雲端
    signInAs('user-1');
    await vi.waitFor(() => {
      expect(node.calls.upserts).toHaveLength(2);
    });
    expect(sortedStoredIds()).toEqual(['campari', 'gin', 'lime']);
  });
});
