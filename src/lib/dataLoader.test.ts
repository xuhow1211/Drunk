/**
 * 靜態資料載入器的單元測試。
 *
 * 驗證：成功時以並行請求取得兩份 JSON、HTTP 錯誤與格式錯誤一律拋出例外
 * （由呼叫端走降級路徑）。fetch 以 stub 模擬，不做真實網路請求。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStaticData } from './dataLoader';

const dataset = { version: '1.0', generatedAt: 'T', recipes: [] };
const catalog = { version: '1.0', categories: {}, ingredients: [], substitutions: [] };

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadStaticData', () => {
  it('成功時回傳兩份資料，且正確請求 /data/ 下的網址', async () => {
    stubFetchSucceed();
    const result = await loadStaticData();
    expect(result.dataset).toEqual(dataset);
    expect(result.catalog).toEqual(catalog);

    const mock = vi.mocked(fetch);
    expect(mock).toHaveBeenCalledWith('/data/cocktails.json');
    expect(mock).toHaveBeenCalledWith('/data/ingredients.json');
  });

  it('任一請求 HTTP 失敗時拋出例外', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    await expect(loadStaticData()).rejects.toThrow('配方資料');
  });

  it('JSON 形狀不符時拋出例外', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (url.endsWith('cocktails.json') ? { recipes: 'not-an-array' } : catalog),
      })),
    );
    await expect(loadStaticData()).rejects.toThrow('配方資料');
  });
});
