/**
 * 資料層來源順序的單元測試（Supabase 為主、靜態 JSON 為輔）。
 *
 * 驗證完整啟動流程：Supabase 建立失敗或查詢失敗時退回靜態 JSON；
 * 靜態 JSON 也失敗時進入 error 狀態。supabase-js 以 vi.mock 模擬，
 * 靜態 JSON 以 stub fetch 模擬，全程不做真實網路請求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

/** 靜態 JSON 降級用的建置產物（形狀與 public/data/*.json 相同）。 */
const staticDatasetPayload = {
  version: '1.0',
  generatedAt: '2026-11-01T00:00:00.000Z',
  recipes: [
    {
      id: 'gin-fizz',
      nameEn: 'Gin Fizz',
      nameZh: '琴費士',
      aliases: [],
      collection: 'classic',
      collections: ['classic'],
      category: 'fizz',
      glass: 'highball',
      ice: 'shake',
      difficulty: 1,
      abv: '13%',
      time: '2 分鐘',
      ingredients: [],
      steps: ['搖盪'],
      garnish: [],
      tags: [],
      flavor: [],
      occasion: [],
      popularity: 10,
      sourceUrl: null,
      ingredientIds: [],
      garnishIds: [],
    },
  ],
};

const staticCatalogPayload = {
  version: '1.0',
  categories: {},
  ingredients: [
    { id: 'gin', zh: '琴酒（金酒）', en: 'Gin', category: 'base-spirit', common: true, aliases: ['金酒'] },
  ],
  substitutions: [],
};

/** Supabase 回傳的 recipes 列（snake_case，含材料嵌入）。 */
const supabaseRecipeRow = {
  id: 'gin-fizz',
  name_en: 'Gin Fizz',
  name_zh: '琴費士',
  aliases: null,
  collections: ['classic'],
  category: 'fizz',
  glass: 'highball',
  ice: 'shake',
  difficulty: 1,
  abv: null,
  time: null,
  popularity: 10,
  steps: ['搖盪'],
  garnish_ids: null,
  flavor: null,
  occasion: null,
  tags: null,
  source_url: null,
  source_site: null,
  recipe_ingredients: [
    { ingredient_id: 'gin', amount: 45, unit: 'ml', optional: false, position: 1 },
  ],
};

/** supabase-js query chain 的假節點：order 可連續呼叫，range 結尾回傳結果。 */
function makeQueryNode(rows: unknown[], error: unknown) {
  const node = {
    order: () => node,
    range: () =>
      error === null
        ? Promise.resolve({ data: rows, error: null })
        : Promise.resolve({ data: null, error }),
  };
  return node;
}

/** 建立「依表名供資料或回傳錯誤」的假 supabase client。 */
function fakeSupabaseClient(mode: 'ok' | 'fail' = 'ok') {
  const failResult = { message: '模擬失敗' };
  return {
    from: (table: string) => ({
      select: () =>
        mode === 'ok'
          ? makeQueryNode(
              table === 'recipes'
                ? [supabaseRecipeRow]
                : table === 'ingredients'
                  ? [staticCatalogPayload.ingredients[0]]
                  : [],
              null,
            )
          : makeQueryNode([], failResult),
    }),
  };
}

/** stub 靜態 JSON 的 fetch（可指定成功或失敗）。 */
function stubStaticFetch(succeed: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!succeed) return { ok: false, status: 500, json: async () => ({}) };
      const payload = url.includes('ingredients') ? staticCatalogPayload : staticDatasetPayload;
      return { ok: true, status: 200, json: async () => payload };
    }),
  );
}

/** 重新載入模組群，取得互不干擾的 dataStore 與 ingredients 實例。 */
async function importFreshStore() {
  vi.resetModules();
  const store = await import('./dataStore');
  const ingredientModule = await import('./ingredients');
  return { ...store, getIngredient: ingredientModule.getIngredient };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  createClientMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('資料來源順序（Supabase 為主、靜態 JSON 為輔）', () => {
  it('Supabase 可用時以 Supabase 資料就緒，不請求靜態 JSON', async () => {
    createClientMock.mockReturnValue(fakeSupabaseClient('ok'));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test');
    stubStaticFetch(true);
    const store = await importFreshStore();

    store.startDataLoad();
    await vi.waitFor(() => {
      expect(store.getDataState().loading).toBe(false);
    });

    const state = store.getDataState();
    expect(state.error).toBeNull();
    expect(state.dataset?.version).toBe('supabase');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    // Supabase 對應後的資料已注入同步索引
    expect(store.getIngredient('gin')?.zh).toBe('琴酒（金酒）');
  });

  it('Supabase 讀取失敗時退回靜態 JSON，應用照常就緒', async () => {
    createClientMock.mockReturnValue(fakeSupabaseClient('fail'));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test');
    stubStaticFetch(true);
    const store = await importFreshStore();

    store.startDataLoad();
    await vi.waitFor(() => {
      expect(store.getDataState().loading).toBe(false);
    });

    const state = store.getDataState();
    expect(state.error).toBeNull();
    expect(state.dataset?.version).toBe('1.0');
    expect(state.dataset?.recipes).toHaveLength(1);
  });

  it('Supabase 與靜態 JSON 皆失敗時進入 error 狀態', async () => {
    createClientMock.mockReturnValue(fakeSupabaseClient('fail'));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test');
    stubStaticFetch(false);
    const store = await importFreshStore();

    store.startDataLoad();
    await vi.waitFor(() => {
      expect(store.getDataState().error).not.toBeNull();
    });

    expect(store.getDataState().loading).toBe(false);
    expect(store.getDataState().dataset).toBeNull();
  });

  it('環境變數未配置時直接走靜態 JSON，不建立 Supabase 用戶端', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    stubStaticFetch(true);
    const store = await importFreshStore();

    store.startDataLoad();
    await vi.waitFor(() => {
      expect(store.getDataState().loading).toBe(false);
    });

    expect(createClientMock).not.toHaveBeenCalled();
    expect(store.getDataState().dataset?.version).toBe('1.0');
  });
});
