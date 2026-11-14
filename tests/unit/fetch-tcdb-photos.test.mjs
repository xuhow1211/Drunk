/**
 * scripts/fetch-tcdb-photos.mjs 的單元測試（假 fetch，不打真網路）。
 *
 * 涵蓋補抓管線的關鍵行為：
 *   1. 名稱正規化與變體（完整名、去 The、去首詞）
 *   2. 命中比對（strDrink／strDrinkAlternate 的正規化形狀交集）
 *   3. 每杯最多 3 次查詢；命中後下載縮圖並上傳
 *   4. 查無照片記為 failed（main 不會為失敗者寫 photo-map 條目）
 *   5. 上傳細節（webp content-type、x-upsert）與跳過判定沿用共用模組
 *
 * 每個測試以 vi.stubGlobal 換上假 fetch，並用 fetchCalls 紀錄請求序列驗證
 * 端點、方法與 header；風格與 fetch-iba-photos.test.mjs 一致。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUCKET_NAME,
  REQUEST_INTERVAL_MS,
  processRecipe,
  publicPhotoUrl,
} from '../../scripts/fetch-iba-photos.mjs';
import {
  hitDrink,
  normalizeDrinkName,
  processTcdbRecipe,
  searchTcdb,
  searchVariants,
  stripThe,
} from '../../scripts/fetch-tcdb-photos.mjs';

const SUPABASE_URL = 'https://rest-project.example.co';
const SERVICE_KEY = 'test-service-key';
const CREDENTIALS = { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY };
const TCDB_API = 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s=';

/** 紀錄假 fetch 收到的請求（url、method、headers、body）。 */
let fetchCalls = [];

/**
 * 安裝假 fetch：每個 (method, url 比對) 回應對應狀態。
 * routes 為陣列 [{ method, urlSuffix, status, body?, headers? }]，先符合者生效；
 * 無符合者回 599，測試能從此抓到未預期的請求。
 */
function installFetch(routes) {
  fetchCalls = [];
  const fake = (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    fetchCalls.push({ url, method, headers: init.headers, body: init.body });
    const match = routes.find(
      (route) => route.method === method && url.startsWith(route.urlSuffix),
    );
    if (!match) {
      return new Response('', { status: 599, statusText: 'unexpected request' });
    }
    return new Response(match.body ?? '', {
      status: match.status,
      statusText: match.status.toString(),
      headers: match.headers ?? {},
    });
  };
  vi.stubGlobal('fetch', fake);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('名稱正規化與變體', () => {
  it('normalizeDrinkName 小寫化並把非英數折成單一空白', () => {
    expect(normalizeDrinkName('Brandy Alexander')).toBe('brandy alexander');
    expect(normalizeDrinkName('C-137 Cooler')).toBe('c 137 cooler');
    expect(normalizeDrinkName('  Moscow Mule!  ')).toBe('moscow mule');
    expect(normalizeDrinkName(null)).toBe('');
  });

  it('stripThe 去除開頭的 The', () => {
    expect(stripThe('the negroni')).toBe('negroni');
    expect(stripThe('negroni')).toBe('negroni');
    expect(stripThe('theater')).toBe('theater');
  });

  it('searchVariants 依序為完整名、去 The、去首詞（單詞名不另生變體）', () => {
    expect(searchVariants('The Negroni')).toEqual(['the negroni', 'negroni']);
    expect(searchVariants('Vodka Gimlet')).toEqual(['vodka gimlet', 'gimlet']);
    expect(searchVariants('Mimosa')).toEqual(['mimosa']);
    expect(searchVariants('')).toEqual([]);
  });
});

describe('命中比對（hitDrink）', () => {
  const drink = (name, alternate = null) => ({
    idDrink: '11007',
    strDrink: name,
    strDrinkAlternate: alternate,
    strDrinkThumb: 'https://www.thecocktaildb.com/image/think/v1/asset/1/gimlet/1.jpg',
  });

  it('strDrink 正規化後與配方英文名相等即命中', () => {
    expect(hitDrink({ nameEn: 'Gimlet' }, [drink('Gimlet')])?.strDrink).toBe('Gimlet');
    expect(hitDrink({ nameEn: 'The Negroni' }, [drink('Negroni')])?.strDrink).toBe('Negroni');
  });

  it('strDrinkAlternate 有值時也參與比對', () => {
    expect(hitDrink({ nameEn: 'Gimlet' }, [drink('Gimlet No. 2', 'Gimlet')])?.strDrinkAlternate).toBe('Gimlet');
  });

  it('去首詞變體可命中（Vodka Gimlet 對 TCDB 的 Gimlet）', () => {
    expect(hitDrink({ nameEn: 'Vodka Gimlet' }, [drink('Gimlet')])?.strDrink).toBe('Gimlet');
  });

  it('僅名字包含不等於命中（避免誤判不相關的酒）', () => {
    expect(hitDrink({ nameEn: 'Gin Fizz' }, [drink('Singapore Gin Sling')])).toBeNull();
  });

  it('查無對應回 null（含查詢結果為 null 的情境）', () => {
    expect(hitDrink({ nameEn: 'Xyzabc' }, [drink('Gimlet')])).toBeNull();
    expect(hitDrink({ nameEn: 'Xyzabc' }, null)).toBeNull();
  });
});

describe('searchTcdb', () => {
  it('查詢打到 search.php?s= 端點並回傳 drinks', async () => {
    installFetch([
      { method: 'GET', urlSuffix: TCDB_API, status: 200, body: JSON.stringify({ drinks: [{ strDrink: 'Gimlet' }] }) },
    ]);
    await expect(searchTcdb('gimlet')).resolves.toEqual([{ strDrink: 'Gimlet' }]);
    expect(fetchCalls[0].url).toBe(`${TCDB_API}gimlet`);
  });

  it('查無結果（drinks 為 null）回空陣列；非 2xx 拋錯', async () => {
    installFetch([{ method: 'GET', urlSuffix: TCDB_API, status: 200, body: 'null' }]);
    await expect(searchTcdb('nothing')).resolves.toEqual([]);

    installFetch([{ method: 'GET', urlSuffix: TCDB_API, status: 500, body: '{}' }]);
    await expect(searchTcdb('nothing')).rejects.toThrow('HTTP 500');
  });
});

describe('單杯處理（processTcdbRecipe）', () => {
  const recipe = { id: 'gimlet-tw', nameEn: 'Vodka Gimlet', photoUrl: undefined };
  const imageUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/gimlet-tw.webp`;
  const thumbUrl = 'https://www.thecocktaildb.com/image/v1/asset/1/gimlet/1.jpg';

  /** search 變體查無的標準回應。 */
  const missBody = JSON.stringify({ drinks: null });
  /** search 命中（Gimlet 命中 Vodka Gimlet 的去首詞變體）。 */
  const hitBody = JSON.stringify({
    drinks: [{ strDrink: 'Gimlet', strDrinkThumb: thumbUrl }],
  });

  it('遠端已存在（HEAD 200）時跳過：只送 HEAD，不查 TCDB、不上傳', async () => {
    installFetch([{ method: 'HEAD', urlSuffix: imageUrl, status: 200 }]);
    const result = await processTcdbRecipe(CREDENTIALS, recipe);
    expect(result.status).toBe('skipped');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].method).toBe('HEAD');
  });

  it('查無對應：最多送 3 次查詢（變體數上限），記為 failed（main 不寫 photo-map 條目）', async () => {
    // 「The Vodka Gin Fizz」的三個變體互不重複：完整名、去 The、去首詞
    const multiVariant = { id: 'the-vodka-gin-fizz', nameEn: 'The Vodka Gin Fizz', photoUrl: undefined };
    installFetch([{ method: 'GET', urlSuffix: TCDB_API, status: 200, body: missBody }]);
    const result = await processTcdbRecipe(CREDENTIALS, multiVariant);
    expect(result.status).toBe('failed');
    expect(result.failure).toContain('TCDB 查無對應照片');
    expect(fetchCalls.filter((call) => call.method === 'GET')).toHaveLength(3);
  });

  it('命中後下載縮圖並上傳（webp content-type、x-upsert）', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'GET', urlSuffix: `${TCDB_API}vodka%20gimlet`, status: 200, body: missBody },
      { method: 'GET', urlSuffix: `${TCDB_API}gimlet`, status: 200, body: hitBody },
      { method: 'GET', urlSuffix: thumbUrl, status: 200, body: 'image-bytes', headers: { 'Content-Type': 'image/webp' } },
      { method: 'POST', urlSuffix: imageUrl, status: 200 },
    ]);
    const result = await processTcdbRecipe(CREDENTIALS, recipe);
    expect(result.status).toBe('uploaded');
    expect(result.warning).toBeUndefined();

    const searchCalls = fetchCalls.filter((call) => call.url.startsWith(TCDB_API));
    // 完整名（查無）→ 去首詞（命中），共 2 次查詢
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls[0].url).toBe(`${TCDB_API}vodka%20gimlet`);
    expect(searchCalls[1].url).toBe(`${TCDB_API}gimlet`);

    const uploaded = fetchCalls.find((call) => call.method === 'POST' && call.url === imageUrl);
    expect(uploaded.headers['Content-Type']).toBe('image/webp');
    expect(uploaded.headers['x-upsert']).toBe('true');
    expect(uploaded.headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it('下載的縮圖超過大小上限（500KB）時拋錯（由呼叫端記失敗）', async () => {
    const bigBody = 'x'.repeat(500 * 1024 + 1);
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'GET', urlSuffix: `${TCDB_API}vodka%20gimlet`, status: 200, body: hitBody },
      { method: 'GET', urlSuffix: thumbUrl, status: 200, body: bigBody },
    ]);
    await expect(processTcdbRecipe(CREDENTIALS, recipe)).rejects.toThrow('超過上限');
  });

  it('上傳非 2xx 時拋錯（重跑可補）', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'GET', urlSuffix: `${TCDB_API}vodka%20gimlet`, status: 200, body: hitBody },
      { method: 'GET', urlSuffix: thumbUrl, status: 200, body: 'image-bytes' },
      { method: 'POST', urlSuffix: imageUrl, status: 500 },
    ]);
    await expect(processTcdbRecipe(CREDENTIALS, recipe)).rejects.toThrow('上傳失敗');
  });

  it('命中但條目缺縮圖網址時記為 failed', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'GET', urlSuffix: `${TCDB_API}vodka%20gimlet`, status: 200, body: JSON.stringify({ drinks: [{ strDrink: 'Gimlet', strDrinkThumb: null }] }) },
    ]);
    const result = await processTcdbRecipe(CREDENTIALS, recipe);
    expect(result.status).toBe('failed');
    expect(result.failure).toContain('縮圖');
  });

  it('TCDB 的搜尋結果回非 2xx 時拋錯，由 main 記入失敗清單', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'GET', urlSuffix: TCDB_API, status: 500, body: '{}' },
    ]);
    await expect(processTcdbRecipe(CREDENTIALS, recipe)).rejects.toThrow('TCDB 查詢失敗');
  });

  it('公開網址公式沿用共用模組（object/public/<桶>/<id>.webp）', () => {
    expect(publicPhotoUrl(SUPABASE_URL, 'gimlet-tw')).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/gimlet-tw.webp`,
    );
  });

  it('請求間隔常數為 300ms（與 IBA 抓圖共用）', () => {
    expect(REQUEST_INTERVAL_MS).toBe(300);
  });

  it('IBA 版 processRecipe 仍可由共用模組匯入使用（不重複實作）', async () => {
    installFetch([{ method: 'HEAD', urlSuffix: imageUrl, status: 200 }]);
    await expect(processRecipe(CREDENTIALS, { id: 'gimlet-tw' })).resolves.toEqual({ status: 'skipped' });
  });
});
