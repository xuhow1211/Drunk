#!/usr/bin/env node
/**
 * join 這麼喝：IBA 示意照片抓取腳本（一次性工具，可重跑）。
 *
 * 用法（憑證完全由環境變數注入；缺任一個就報錯退出，不猜測、不 fallback）：
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_key> \
 *   node scripts/fetch-iba-photos.mjs
 *
 * 流程：
 *   1. 讀 src/data/cocktails.json，找出 sourceUrl 指向 iba-world.com 的配方
 *   2. 桶不存在時以 Storage REST API 建立（名 recipe-photos、公開讀取）
 *   3. 對每杯循序抓頁（每請求間隔 300ms，禮節性），取主圖、下載（上限 500KB）、
 *      上傳到 Storage 的 <recipe-id>.webp（x-upsert，已存在就覆蓋）
 *   4. 產出 data/photo-map.json：{ generatedAt, photos: { [id]: { url } } }
 *
 * 主圖判定（iba-world.com 頁面結構，見分析報告第二節實測）：
 *   優先取 <img> 的 src 或 srcset 檔名含配方 id 或英文名小寫者；
 *   找不到則取第一張 fetchpriority="high" 的 img；都找不到記為失敗。
 *
 * 重跑安全性：已上傳的物件以 HEAD 檢查（回應 200 即跳過），
 * photo-map 為重建式產出（每次以既有 photos 為底加上新上傳者）。
 * CI 不執行本腳本：抓圖依賴外部網路，正式抓圖由主控在本地執行。
 *
 * 實作說明：supabase-js 的 client 在 Node 20 建構時會初始化 realtime 子模組，
 * 因缺全域 WebSocket 直接拋例外（實測錯誤），故 Storage 操作全部改用 REST API
 * （Node 內建 fetch），不再 depend 於 supabase-js。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPhotoMap } from './photo-map.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
/** 建置產物（配方清單）位置。 */
const COCKTAILS_PATH = path.join(ROOT_DIR, 'src', 'data', 'cocktails.json');
/** photo-map 產出位置（data/ 為原始資料目錄，跟著 repo 版控）。 */
const PHOTO_MAP_PATH = path.join(ROOT_DIR, 'data', 'photo-map.json');
/** Supabase Storage 的目標桶名。 */
const BUCKET_NAME = 'recipe-photos';
/** 兩次外部請求的間隔（ms），禮節性限速。 */
const REQUEST_INTERVAL_MS = 300;
/** 單張圖片的下載上限（bytes）。 */
const MAX_IMAGE_BYTES = 500 * 1024;

/** 執行期間的統計與失敗紀錄（結束時彙總輸出）。 */
const stats = {
  success: [],
  skipped: [],
  failed: [],
  warnings: [],
};

/** 等待指定毫秒。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 讀取憑證；讀不到即拋錯（由 main 轉為報錯退出，不 fallback 到 anon key）。
 * 刻意在呼叫時讀取（而非 import 時），測試得以注入假環境變數載入本模組。
 */
function getCredentials() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('請設定 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 環境變數。');
  }
  return { supabaseUrl, serviceKey };
}

/** Storage REST 請求共用的授權 header（密鑰只在此組裝，不落盤、不列印）。 */
function storageHeaders(serviceKey, extra = {}) {
  return { Authorization: `Bearer ${serviceKey}`, ...extra };
}

/** Storage 物件的 REST 端點（<recipe-id>.webp）。 */
function storageObjectUrl(supabaseUrl, recipeId) {
  return `${supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${recipeId}.webp`;
}

/** Storage 物件的公開網址（<recipe-id>.webp）。 */
function publicPhotoUrl(supabaseUrl, recipeId) {
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${recipeId}.webp`;
}

/**
 * 確認 Storage 桶存在；不存在時以 REST API 建立（公開讀取）。
 *
 * 冪等：GET 回 200 視為已存在；「不存在」回 404，或 Storage 的
 * 變體（HTTP 400 ＋ body 含 NoSuchBucket「Bucket not found」），
 * 兩者皆視為桶不存在並 POST 建桶；
 * 建桶回 409（並行下已被他人建立）視同成功，其餘非 2xx 拋錯。
 * 既有桶的公開設定由建立時決定，腳本不改動既有桶。
 */
async function ensureBucket({ supabaseUrl, serviceKey }) {
  const getResponse = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET_NAME}`, {
    headers: storageHeaders(serviceKey),
  });
  if (getResponse.ok) return;
  if (getResponse.status === 400) {
    // Storage 對「桶不存在」的回應固定為 HTTP 400，錯誤碼在 body 內；
    // 視為不存在，落到下方建立流程
    const body = (await getResponse.text()).toUpperCase();
    if (!body.includes('NOSUCHBUCKET')) {
      throw new Error(`查詢 Storage 桶「${BUCKET_NAME}」失敗：HTTP ${getResponse.status}`);
    }
  } else if (getResponse.status !== 404) {
    throw new Error(`查詢 Storage 桶「${BUCKET_NAME}」失敗：HTTP ${getResponse.status}`);
  }
  const createResponse = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: storageHeaders(serviceKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: BUCKET_NAME, public: true }),
  });
  if (createResponse.ok || createResponse.status === 409) return;
  throw new Error(`建立 Storage 桶「${BUCKET_NAME}」失敗：HTTP ${createResponse.status}`);
}

/** 以 HEAD 檢查遠端物件是否已存在（200 即視為已上傳，跳過）。 */
async function isAlreadyUploaded({ supabaseUrl, serviceKey }, recipeId) {
  try {
    const response = await fetch(storageObjectUrl(supabaseUrl, recipeId), {
      method: 'HEAD',
      headers: storageHeaders(serviceKey),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 上傳單張照片（x-upsert：已存在就覆蓋）。
 *
 * 路徑固定為 <recipe-id>.webp；IBA 主圖實測為 webp。
 * @returns {Promise<void>} 上傳失敗（非 2xx）時拋出錯誤
 */
async function uploadPhoto({ supabaseUrl, serviceKey }, recipeId, buffer) {
  const response = await fetch(storageObjectUrl(supabaseUrl, recipeId), {
    method: 'POST',
    headers: storageHeaders(serviceKey, {
      'Content-Type': 'image/webp',
      'x-upsert': 'true',
    }),
    body: new Uint8Array(buffer),
  });
  if (!response.ok) {
    throw new Error(`上傳失敗：HTTP ${response.status}`);
  }
}

/** 主圖比對用的關鍵字：配方 id 與英文名（皆小寫）。 */
function imageKeywords(recipe) {
  return [recipe.id.toLowerCase(), String(recipe.nameEn ?? '').toLowerCase()].filter(Boolean);
}

/** 把相對圖片網址轉為絕對網址；轉換失敗（非法 URL）時回傳 null。 */
function toAbsoluteUrl(candidate, pageUrl) {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, pageUrl).href;
  } catch {
    return null;
  }
}

/**
 * 從單一 <img> 標籤抽出候補圖片網址。
 *
 * 只解析 src 與 srcset；srcset 以逗號分隔、每段以空白切出網址，
 * 依序排列（src 在前、srcset 的各候補在後）。
 *
 * @param {string} imgTag 完整的 <img ...> 標籤字串
 * @param {string} pageUrl 所在頁面網址（相對網址的基準）
 * @returns {string[]} 絕對網址清單（可能為空）
 */
function extractImageUrls(imgTag, pageUrl) {
  const urls = [];
  // 負向斷言排除 data-src 等以連字號開頭的 lazy-loading 屬性，
  // 避免把 placeholder 當成候補網址
  const src = imgTag.match(/(?<![\w-])src\s*=\s*["']([^"']+)["']/i);
  if (src?.[1]) {
    const absolute = toAbsoluteUrl(src[1], pageUrl);
    if (absolute) urls.push(absolute);
  }
  const srcset = imgTag.match(/(?<![\w-])srcset\s*=\s*["']([^"']+)["']/i);
  if (srcset?.[1]) {
    for (const candidate of srcset[1].split(',')) {
      const url = toAbsoluteUrl(candidate.split(/\s+/)[0] ?? '', pageUrl);
      if (url) urls.push(url);
    }
  }
  return urls;
}

/**
 * 依優先序找出頁面主圖。
 *
 * 優先一：任一 img 的 src 或 srcset 網址（小寫比對）含配方 id 或英文名；
 * 優先二：第一張帶 fetchpriority="high" 的 img 的第一個網址。
 * 兩者皆找不到時回傳 null（呼叫端記為失敗）。
 */
function findMainImage(html, pageUrl, keywords) {
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];

  for (const tag of imgTags) {
    const hit = extractImageUrls(tag, pageUrl).find((url) =>
      keywords.some((keyword) => url.toLowerCase().includes(keyword)),
    );
    if (hit) return hit;
  }

  for (const tag of imgTags) {
    if (!/fetchpriority\s*=\s*["']high["']/i.test(tag)) continue;
    const first = extractImageUrls(tag, pageUrl)[0];
    if (first) return first;
  }
  return null;
}

/** 抓取配方頁的 HTML；非 2xx 時拋出錯誤。 */
async function fetchHtml(pageUrl) {
  const response = await fetch(pageUrl, {
    headers: { 'user-agent': 'join-drunk-photo-pipeline/1.0' },
  });
  if (!response.ok) {
    throw new Error(`抓頁失敗（HTTP ${response.status}）`);
  }
  return response.text();
}

/**
 * 下載主圖；超過大小上限或非 2xx 時拋出錯誤。
 *
 * @param {string} imageUrl 主圖網址
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
async function downloadImage(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`下載圖失敗（HTTP ${response.status}）`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`圖片 ${buffer.length} bytes 超過上限 ${MAX_IMAGE_BYTES} bytes`);
  }
  return { buffer, contentType: response.headers.get('content-type') ?? '' };
}

/**
 * 處理單杯配方：跳過判定、抓頁、取主圖、下載與上傳。
 *
 * 統計由回傳值描述、由 main（測試則由呼叫端）記錄，本函式不觸碰副作用狀態。
 * @param {{ supabaseUrl: string, serviceKey: string }} credentials 憑證
 * @param {object} recipe 配方（sourceUrl 已指向 iba-world.com）
 * @returns {Promise<{ status: 'uploaded' | 'skipped' | 'failed',
 *   warning?: string, failure?: string }>}
 */
async function processRecipe(credentials, recipe) {
  if (await isAlreadyUploaded(credentials, recipe.id)) {
    return { status: 'skipped' };
  }

  const html = await fetchHtml(recipe.sourceUrl);
  await sleep(REQUEST_INTERVAL_MS);

  const imageUrl = findMainImage(html, recipe.sourceUrl, imageKeywords(recipe));
  if (!imageUrl) {
    return {
      status: 'failed',
      failure: `頁面找不到主圖（${recipe.sourceUrl}）`,
    };
  }

  const { buffer, contentType } = await downloadImage(imageUrl);
  const warning =
    contentType && !contentType.includes('image/webp')
      ? `來源 content-type 非 webp（${contentType}）` // 來源非 webp 時仍以 webp 副檔名存放（路徑契約）
      : undefined;
  await uploadPhoto(credentials, recipe.id, buffer);
  return { status: 'uploaded', warning };
}

/** 主流程：讀配方 → 建桶 → 循序處理 → 產出 photo-map → 彙總。 */
async function main() {
  const dataset = JSON.parse(fs.readFileSync(COCKTAILS_PATH, 'utf8'));
  const ibaRecipes = (dataset.recipes ?? []).filter(
    (recipe) => typeof recipe.sourceUrl === 'string' && recipe.sourceUrl.includes('iba-world.com'),
  );

  let credentials;
  try {
    credentials = getCredentials();
  } catch (error) {
    console.error(`錯誤：${error.message}`);
    process.exit(1);
  }
  console.log(`目標：${ibaRecipes.length} 杯 IBA 配方（桶：${BUCKET_NAME}）`);

  try {
    await ensureBucket(credentials);
  } catch (error) {
    console.error(`錯誤：${error.message}`);
    process.exit(1);
  }

  // 既有 photo-map 為底：上一次的條目保留，遠端已被刪除者會因 HEAD 非 200 而重抓。
  const existingPhotos = readPhotoMap(PHOTO_MAP_PATH)?.photos ?? {};

  for (const recipe of ibaRecipes) {
    // 失敗在紀錄時加上配方 id；sleep 只在例外路徑進行。
    try {
      const result = await processRecipe(credentials, recipe);
      // 上傳與跳過（遠端已存在）都確保 photo-map 條目存在；
      // 上一次條目遺失但遠端物件健在時，重跑也能補齊。
      if (result.status !== 'failed') {
        existingPhotos[recipe.id] = { url: publicPhotoUrl(credentials.supabaseUrl, recipe.id) };
        if (result.status === 'uploaded') stats.success.push(recipe.id);
        if (result.status === 'skipped') stats.skipped.push(recipe.id);
        if (result.warning) stats.warnings.push(`${recipe.id}：${result.warning}`);
      } else {
        stats.failed.push(`${recipe.id}：${result.failure}`);
      }
    } catch (error) {
      stats.failed.push(`${recipe.id}：${error.message}`);
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  const generatedAt = new Date().toISOString();
  const summary = { generatedAt, photos: existingPhotos };
  fs.writeFileSync(PHOTO_MAP_PATH, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('=== 示意照片抓取完成 ===');
  console.log(`成功：${stats.success.length} 杯、跳過（遠端已存在）：${stats.skipped.length} 杯、失敗：${stats.failed.length} 杯`);
  if (stats.success.length > 0) console.log(`成功清單：${stats.success.join('、')}`);
  if (stats.skipped.length > 0) console.log(`跳過清單：${stats.skipped.join('、')}`);
  for (const item of stats.warnings) console.log(`[警告] ${item}`);
  if (stats.failed.length > 0) {
    console.log('失敗清單（可修正後重跑）：');
    for (const item of stats.failed) console.log(`  - ${item}`);
  }
  console.log(`photo-map 已寫入：${path.relative(ROOT_DIR, PHOTO_MAP_PATH)}`);
}

// 直接以 node 執行才跑主流程；被測試 import 時不執行（純匯出供測）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  BUCKET_NAME,
  storageHeaders,
  storageObjectUrl,
  publicPhotoUrl,
  ensureBucket,
  isAlreadyUploaded,
  uploadPhoto,
  getCredentials,
  imageKeywords,
  extractImageUrls,
  findMainImage,
  processRecipe,
};
