/**
 * 資料層（dataStore）的單元測試。
 *
 * 驗證整個啟動流程：載入成功時把資料放進狀態並注入食材索引；
 * 載入失敗時保留空資料與錯誤訊息（同步查詢不拋出例外）。
 * fetch 以 stub 模擬，不做真實網路請求；每個案例都重新載入模組
 * （resetModules），避免 started 守門互相干擾。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CocktailDataset, IngredientCatalog } from './types';

const dataset: CocktailDataset = {
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

const catalog: IngredientCatalog = {
  version: '1.0',
  categories: {},
  ingredients: [
    {
      id: 'gin',
      zh: '琴酒（金酒）',
      en: 'Gin',
      category: 'base-spirit',
      common: true,
      aliases: ['金酒'],
    },
  ],
  substitutions: [],
};

/** 依網址回傳對應 JSON 的假 fetch。 */
function stubFetchSucceed(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('cocktails.json') ? dataset : catalog),
    })),
  );
}

/** 讓失敗發生：第一個請求直接網路錯誤。 */
function stubFetchReject(): void {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('網路不通'))));
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
  // 資料層測試一律走靜態路徑：清空 Supabase 環境變數，
  // 避免本機 .env.local 的設定影響測試結果。
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('startDataLoad', () => {
  it('載入成功：狀態轉為就緒，且同步索引已注入', async () => {
    stubFetchSucceed();
    const store = await importFreshStore();

    const updates: string[] = [];
    store.subscribeDataState(() => {
      const state = store.getDataState();
      updates.push(state.loading ? 'loading' : state.error ? 'error' : 'ready');
    });

    store.startDataLoad();
    store.startDataLoad(); // 重複呼叫不應重跑

    await vi.waitFor(() => {
      expect(store.getDataState().loading).toBe(false);
    });

    const state = store.getDataState();
    expect(state.dataset?.recipes).toHaveLength(1);
    expect(state.dataset?.version).toBe('1.0'); // 未配置 Supabase 時走靜態 JSON
    expect(state.error).toBeNull();
    expect(updates).toEqual(['loading', 'ready']);
    // 同步索引已注入：getIngredient 立即查得到
    expect(store.getIngredient('gin')?.zh).toBe('琴酒（金酒）');
  });

  it('載入失敗：錯誤進入狀態，同步查詢回傳空結果而不拋出例外', async () => {
    stubFetchReject();
    const store = await importFreshStore();

    store.startDataLoad();
    await vi.waitFor(() => {
      expect(store.getDataState().error).not.toBeNull();
    });

    const state = store.getDataState();
    expect(state.loading).toBe(false);
    expect(state.dataset).toBeNull();
    expect(store.getIngredient('gin')).toBeUndefined();
    expect(() => store.getIngredient('gin')).not.toThrow();
  });
});
