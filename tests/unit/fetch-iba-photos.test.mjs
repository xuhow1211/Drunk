/**
 * scripts/fetch-iba-photos.mjs 的單元測試（假 fetch，不打真網路）。
 *
 * 涵蓋 REST 化後的四個關鍵行為：
 *   1. 主圖判定規則不變（關鍵字優先、fetchpriority 後備、找不到記失敗）
 *   2. 桶不存在 → 建桶 → 上傳（GET bucket 404 → POST bucket → POST object）
 *   3. 物件已存在 → 跳過（只送 HEAD object，不抓頁不上傳）
 *   4. 失敗情境正確回報（頁面無主圖；上傳非 2xx 拋錯由 main 記入失敗清單）
 *
 * 每個測試以 vi.stubGlobal 換上假 fetch，並用 fetchCalls 紀錄請求序列驗證
 * REST 端點、方法與 header。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUCKET_NAME,
  ensureBucket,
  findMainImage,
  isAlreadyUploaded,
  processRecipe,
  publicPhotoUrl,
  uploadPhoto,
} from '../../scripts/fetch-iba-photos.mjs';

const SUPABASE_URL = 'https://rest-project.example.co';
const SERVICE_KEY = 'test-service-key';
const CREDENTIALS = { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY };

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

describe('主圖判定（findMainImage）', () => {
  const pageUrl = 'https://www.iba-world.co.uk/cocktail/negroni/';

  it('src 含配方關鍵字者優先，即使它不是第一張或未標 high', () => {
    const html =
      '<img fetchpriority="high" src="/fallback.jpg">' +
      '<img src="/media/photos/campari/negroni.webp">';
    expect(findMainImage(html, pageUrl, ['negroni'])).toBe(
      'https://www.iba-world.co.uk/media/photos/campari/negroni.webp',
    );
  });

  it('關鍵字可落在 srcset 的候補網址（相對路徑轉絕對）', () => {
    const html =
      '<img src="/thumb.jpg" ' +
      'srcset="/img/negroni-320.webp 320w, /img/negroni-640.webp 640w">';
    expect(findMainImage(html, pageUrl, ['negroni'])).toBe(
      'https://www.iba-world.co.uk/img/negroni-320.webp',
    );
  });

  it('無關鍵字命中時，回第一張 fetchpriority="high" 的第一個網址', () => {
    const html = '<img src="/a.jpg"><img fetchpriority="high" srcset="/b.webp 640w">';
    expect(findMainImage(html, pageUrl, ['nothing-matches'])).toBe(
      'https://www.iba-world.co.uk/b.webp',
    );
  });

  it('兩規則皆不成立時回 null（呼叫端記為失敗）', () => {
    const html = '<img src="/a.jpg"><img src="/b.jpg">';
    expect(findMainImage(html, pageUrl, ['nothing-matches'])).toBeNull();
    expect(findMainImage('', pageUrl, ['negroni'])).toBeNull();
  });
});

describe('Storage REST：桶建立（ensureBucket）', () => {
  const bucketUrl = `${SUPABASE_URL}/storage/v1/bucket/${BUCKET_NAME}`;

  it('桶已存在（GET 200）時不送建桶請求', async () => {
    installFetch([
      { method: 'GET', urlSuffix: bucketUrl, status: 200, body: JSON.stringify({ name: BUCKET_NAME, public: true }) },
    ]);
    await expect(ensureBucket(CREDENTIALS)).resolves.toBeUndefined();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it('桶不存在（GET 404）時以 POST 建立（body 含 name 與 public: true）', async () => {
    installFetch([
      { method: 'GET', urlSuffix: bucketUrl, status: 404 },
      { method: 'POST', urlSuffix: `${SUPABASE_URL}/storage/v1/bucket`, status: 200, body: '{"name":"recipe-photos"}' },
    ]);
    await expect(ensureBucket(CREDENTIALS)).resolves.toBeUndefined();
    const createCall = fetchCalls.find((call) => call.method === 'POST');
    expect(createCall.url).toBe(`${SUPABASE_URL}/storage/v1/bucket`);
    expect(JSON.parse(createCall.body)).toEqual({ name: BUCKET_NAME, public: true });
    expect(createCall.headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(createCall.headers['Content-Type']).toBe('application/json');
  });

  it('建桶回 409（並行下已被建立）視同成功，不拋錯', async () => {
    installFetch([
      { method: 'GET', urlSuffix: bucketUrl, status: 404 },
      { method: 'POST', urlSuffix: `${SUPABASE_URL}/storage/v1/bucket`, status: 409 },
    ]);
    await expect(ensureBucket(CREDENTIALS)).resolves.toBeUndefined();
  });

  it('查桶非 404 的失敗（如 401）要拋錯', async () => {
    installFetch([{ method: 'GET', urlSuffix: bucketUrl, status: 401 }]);
    await expect(ensureBucket(CREDENTIALS)).rejects.toThrow('HTTP 401');
  });

  it('建桶其他非 2xx（如 403）要拋錯', async () => {
    installFetch([
      { method: 'GET', urlSuffix: bucketUrl, status: 404 },
      { method: 'POST', urlSuffix: `${SUPABASE_URL}/storage/v1/bucket`, status: 403 },
    ]);
    await expect(ensureBucket(CREDENTIALS)).rejects.toThrow('HTTP 403');
  });
});

describe('Storage REST：物件存在檢查與上傳', () => {
  it('HEAD 200（遠端已存在）回 true，非 2xx 或網路錯誤回 false', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/negroni.webp`, status: 200 },
    ]);
    await expect(isAlreadyUploaded(CREDENTIALS, 'negroni')).resolves.toBe(true);

    installFetch([
      { method: 'HEAD', urlSuffix: `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/negroni.webp`, status: 404 },
    ]);
    await expect(isAlreadyUploaded(CREDENTIALS, 'negroni')).resolves.toBe(false);

    installFetch([{ method: 'HEAD', urlSuffix: `${SUPABASE_URL}/storage/v1/object/`, status: 404 }]);
    await expect(isAlreadyUploaded(CREDENTIALS, 'negroni')).resolves.toBe(false);
  });

  it('上傳送到物件端點，header 含 x-upsert 與 image/webp', async () => {
    installFetch([
      { method: 'POST', urlSuffix: `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/negroni.webp`, status: 200 },
    ]);
    const buffer = Buffer.from('image-bytes');
    await expect(uploadPhoto(CREDENTIALS, 'negroni', buffer)).resolves.toBeUndefined();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(`${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/negroni.webp`);
    expect(fetchCalls[0].headers['Content-Type']).toBe('image/webp');
    expect(fetchCalls[0].headers['x-upsert']).toBe('true');
    expect(fetchCalls[0].headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it('上傳非 2xx 時拋錯', async () => {
    installFetch([
      { method: 'POST', urlSuffix: `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/negroni.webp`, status: 400 },
    ]);
    await expect(uploadPhoto(CREDENTIALS, 'negroni', Buffer.from('x'))).rejects.toThrow('HTTP 400');
  });
});

describe('單杯處理（processRecipe）', () => {
  const pageUrl = 'https://www.iba-world.co.uk/cocktail/negroni/';
  const recipe = {
    id: 'negroni',
    nameEn: 'Negroni',
    sourceUrl: pageUrl,
  };
  const pageWithMain = '<img src="/img/served/negroni.webp">';
  const pageWithoutMain = '<img src="/img/banner.webp">';
  const imageUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/negroni.webp`;

  it('遠端已存在（HEAD 200）時跳過：只送 HEAD，不查桶、不抓頁、不上傳', async () => {
    installFetch([{ method: 'HEAD', urlSuffix: imageUrl, status: 200 }]);
    const result = await processRecipe(CREDENTIALS, recipe);
    expect(result.status).toBe('skipped');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].method).toBe('HEAD');
  });

  it('桶不存在 → 建桶 → 抓頁下載 → 上傳的完整管線；source 是 webp 時無警告', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'GET', urlSuffix: `${SUPABASE_URL}/storage/v1/bucket/${BUCKET_NAME}`, status: 404 },
      { method: 'POST', urlSuffix: `${SUPABASE_URL}/storage/v1/bucket`, status: 200, body: '{"name":"recipe-photos"}' },
      { method: 'GET', urlSuffix: pageUrl, status: 200, body: pageWithMain, headers: { 'Content-Type': 'text/html' } },
      { method: 'GET', urlSuffix: 'https://www.iba-world.co.uk/img/served/negroni.webp', status: 200, body: 'webp-bytes', headers: { 'Content-Type': 'image/webp' } },
      { method: 'POST', urlSuffix: imageUrl, status: 200 },
    ]);
    await expect(ensureBucket(CREDENTIALS)).resolves.toBeUndefined();
    const result = await processRecipe(CREDENTIALS, recipe);
    expect(result.status).toBe('uploaded');
    expect(result.warning).toBeUndefined();
    // 建桶：GET 404 + POST；上傳：POST（upsert）。
    const createBucket = fetchCalls.find(
      (call) => call.method === 'POST' && call.url === `${SUPABASE_URL}/storage/v1/bucket`,
    );
    expect(JSON.parse(createBucket.body)).toEqual({ name: BUCKET_NAME, public: true });
    const uploaded = fetchCalls.find((call) => call.method === 'POST' && call.url === imageUrl);
    expect(uploaded.headers['x-upsert']).toBe('true');
    expect(uploaded.headers['Content-Type']).toBe('image/webp');
  });

  it('來源 content-type 非 webp 時仍上傳（webp 副檔名）並列入警告', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'POST', urlSuffix: imageUrl, status: 200 },
      { method: 'GET', urlSuffix: pageUrl, status: 200, body: pageWithMain },
      { method: 'GET', urlSuffix: 'https://www.iba-world.co.uk/img/served/negroni.webp', status: 200, body: 'jpeg-bytes', headers: { 'Content-Type': 'image/jpeg' } },
    ]);
    const result = await processRecipe(CREDENTIALS, recipe);
    expect(result.status).toBe('uploaded');
    expect(result.warning).toContain('image/jpeg');
    const uploaded = fetchCalls.find((call) => call.method === 'POST' && call.url === imageUrl);
    expect(uploaded).toBeDefined();
  });

  it('頁面無主圖時記為 failed 並附上失敗訊息（供 main 列入失敗清單）', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'GET', urlSuffix: pageUrl, status: 200, body: pageWithoutMain },
    ]);
    const result = await processRecipe(CREDENTIALS, recipe);
    expect(result.status).toBe('failed');
    expect(result.failure).toContain('找不到主圖');
    // 找不到主圖時不應送出上傳請求。
    expect(fetchCalls.some((call) => call.method === 'POST' && call.url.includes('/object/'))).toBe(false);
  });

  it('上傳失敗（非 2xx）向外拋錯，由 main 記入失敗清單後重跑可補', async () => {
    installFetch([
      { method: 'HEAD', urlSuffix: imageUrl, status: 404 },
      { method: 'GET', urlSuffix: pageUrl, status: 200, body: pageWithMain },
      { method: 'GET', urlSuffix: 'https://www.iba-world.co.uk/img/served/negroni.webp', status: 200, body: 'webp-bytes', headers: { 'Content-Type': 'image/webp' } },
      { method: 'POST', urlSuffix: imageUrl, status: 500 },
    ]);
    await expect(processRecipe(CREDENTIALS, recipe)).rejects.toThrow('上傳失敗');
  });

  it('公開網址公式不變（object/public/<桶>/<id>.webp）', () => {
    expect(publicPhotoUrl(SUPABASE_URL, 'negroni')).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/negroni.webp`,
    );
  });
});
