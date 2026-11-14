#!/usr/bin/env node
/**
 * join 這麼喝：TheCocktailDB 示意照片補抓腳本（一次性工具，可重跑）。
 *
 * 用途：IBA 抓圖（scripts/fetch-iba-photos.mjs）後仍無實照的配方，
 * 依英文名至 TheCocktailDB 的公開搜尋 API 比對，命中者下載縮圖
 * （上限 500KB）上傳到同一個 Storage 桶，並在 photo-map 條目標記 source: 'tcdb'。
 *
 * 用法（憑證完全由環境變數注入；缺任一個就報錯退出，不猜測、不 fallback）：
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_key> \
 *   node scripts/fetch-tcdb-photos.mjs
 *
 * 流程：
 *   1. 讀 src/data/cocktails.json，找出沒有 photoUrl 的配方
 *   2. 桶不存在時以 Storage REST API 建立（共用 fetch-iba-photos 的實作）
 *   3. 對每杯循序搜尋：依正規化名稱變體逐個查詢 search.php?s=，
 *      每請求間隔 300ms、每杯最多 3 次查詢
 *   4. 命中（比對 strDrink／strDrinkAlternate 的正規化形狀）後下載
 *      strDrinkThumb 上傳到 <recipe-id>.webp
 *   5. photo-map 條目寫入 { url, source: 'tcdb' }；查無者不寫條目、記入失敗清單
 *
 * 選擇 TheCocktailDB 為第二來源的理由：IBA 抓的是頁面 HTML 主圖（結構耦合），
 * TCDB 提供純 JSON API 與穩定縮圖網址，兩者關注點不同——各自獨立腳本可分別重跑，
 * 共用的 Storage 操作（建桶、存在檢查、上傳、公開網址）直接 import 前者。
 * 重跑安全性與 IBA 版相同：已上傳者以 HEAD 跳過，photo-map 為既有照片打底的重建式產出。
 * CI 不執行本腳本：抓圖依賴外部網路，正式抓圖由主控在本地執行。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BUCKET_NAME,
  REQUEST_INTERVAL_MS,
  publicPhotoUrl,
  ensureBucket,
  isAlreadyUploaded,
  uploadPhoto,
  getCredentials,
  downloadImage,
} from './fetch-iba-photos.mjs';
import { readPhotoMap } from './photo-map.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
/** 建置產物（配方清單）位置。 */
const COCKTAILS_PATH = path.join(ROOT_DIR, 'src', 'data', 'cocktails.json');
/** photo-map 產出位置（與 IBA 抓圖共用，跟著 repo 版控）。 */
const PHOTO_MAP_PATH = path.join(ROOT_DIR, 'data', 'photo-map.json');
/** TheCocktailDB 的公開搜尋 API（免 key 的社群測試端點）。 */
const TCDB_SEARCH_API = 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s=';

/** 等待指定毫秒。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 名稱正規化：小寫、非英數字元折為單一空白、去除首尾空白。
 *
 * 比對兩來源名稱時不考慮標點與大小寫差異
 * （例如「Brandy Alexander」與「Brandy  Alexander」應視為同名）。
 *
 * @param {string} name 原始名稱
 * @returns {string} 正規化後的名稱
 */
export function normalizeDrinkName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * 去除開頭的定冠詞 The（正規化後的形狀）。
 *
 * @param {string} normalizedName 已正規化的名稱
 * @returns {string} 去除 The 後的名稱（無 The 時原樣回傳）
 */
export function stripThe(normalizedName) {
  return normalizedName.replace(/^the /, '');
}

/**
 * 比對用的名稱變體清單。
 *
 * 依序為：完整正規化名、去除 The、去除首詞（僅在名稱超過一詞時提供）。
 * 首詞常是形容詞或風味修飾（如「Vodka Gimlet」對 TCDB 的「Gimlet」），
 * 兩來源對同一杯酒的取名差異多落在這些位置。
 *
 * @param {string} nameEn 配方英文名
 * @returns {string[]} 正規化變體（去重、去空）
 */
export function searchVariants(nameEn) {
  const base = normalizeDrinkName(nameEn);
  if (!base) return [];
  const stripped = stripThe(base);
  const variants = [base, stripped];
  // 去首詞以「去 The 後的名稱」為基準：The 屬冠詞不算首詞
  const withoutFirstWord = stripped.split(' ').slice(1).join(' ');
  if (withoutFirstWord && withoutFirstWord !== stripped) {
    variants.push(withoutFirstWord);
  }
  return [...new Set(variants)];
}

/**
 * 判斷查詢結果中是否有一杯對應本配方。
 *
 * 比對方式：TCDB 的 strDrink／strDrinkAlternate 各自套用相同的名稱變體
 * （完整、去 The、去首詞），與配方自身的變體取交集即視為命中；
 * 兩側都用同一組變體，避免單向「包含」比對把不相關的酒（如 Gin Fizz
 * 對上 Singapore Gin Sling）誤判為同一杯。
 *
 * @param {object} recipe 配方（比對 recipe.nameEn）
 * @param {Array<{ strDrink: string, strDrinkAlternate: string | null }>} drinks 查詢結果
 * @returns {object | null} 命中的 drink；無對應時為 null
 */
export function hitDrink(recipe, drinks) {
  const recipeVariants = searchVariants(recipe.nameEn);
  for (const drink of drinks ?? []) {
    const drinkNames = [drink.strDrink, drink.strDrinkAlternate]
      .filter((name) => typeof name === 'string' && name.trim() !== '')
      .map((name) => searchVariants(name))
      .flat();
    if (drinkNames.some((name) => recipeVariants.includes(name))) {
      return drink;
    }
  }
  return null;
}

/**
 * 查詢 TCDB；非 2xx 時拋出錯誤，查無結果（drinks 為 null）回空陣列。
 *
 * @param {string} name 搜尋關鍵字（原樣附加於 API 網址）
 * @returns {Promise<object[]>} 搜尋結果列
 */
export async function searchTcdb(name) {
  const response = await fetch(`${TCDB_SEARCH_API}${encodeURIComponent(name)}`, {
    headers: { 'user-agent': 'join-drunk-photo-pipeline/1.0' },
  });
  if (!response.ok) {
    throw new Error(`TCDB 查詢失敗（HTTP ${response.status}）`);
  }
  const body = await response.json();
  return body?.drinks ?? [];
}

/**
 * 處理單杯配方：跳過判定、搜尋、下載與上傳。
 *
 * 統計由回傳值描述、由 main（測試則由呼叫端）記錄，本函式不觸碰副作用狀態。
 * @param {{ supabaseUrl: string, serviceKey: string }} credentials 憑證
 * @param {object} recipe 配方（photoUrl 為 undefined 者）
 * @returns {Promise<{ status: 'uploaded' | 'skipped' | 'failed', warning?: string, failure?: string }>}
 */
export async function processTcdbRecipe(credentials, recipe) {
  if (await isAlreadyUploaded(credentials, recipe.id)) {
    return { status: 'skipped' };
  }

  const variants = searchVariants(recipe.nameEn);
  // 每杯最多 3 次查詢：變體清單本就在 3 個以內，這裡顯式裁剪以防未來規則放寬
  let hit = null;
  for (const variant of variants.slice(0, 3)) {
    const drinks = await searchTcdb(variant);
    hit = hitDrink(recipe, drinks);
    if (hit) break;
    await sleep(REQUEST_INTERVAL_MS);
  }
  if (!hit) {
    return { status: 'failed', failure: 'TCDB 查無對應照片' };
  }

  const thumb = typeof hit.strDrinkThumb === 'string' ? hit.strDrinkThumb : null;
  if (!thumb) {
    return { status: 'failed', failure: 'TCDB 條目缺縮圖網址' };
  }

  const { buffer, contentType } = await downloadImage(thumb);
  const warning =
    contentType && !contentType.includes('image/webp')
      ? `來源 content-type 非 webp（${contentType}）` // 仍以 webp 副檔名存放（路徑契約）
      : undefined;
  await uploadPhoto(credentials, recipe.id, buffer);
  return { status: 'uploaded', warning };
}

/** 執行期間的統計與失敗紀錄（結束時彙總輸出）。 */
const stats = {
  success: [],
  skipped: [],
  failed: [],
  warnings: [],
};

/** 主流程：找出無照片配方 → 建桶 → 循序補抓 → 產出 photo-map → 彙總。 */
async function main() {
  const dataset = JSON.parse(fs.readFileSync(COCKTAILS_PATH, 'utf8'));
  const pending = (dataset.recipes ?? []).filter((recipe) => recipe.photoUrl === undefined);

  let credentials;
  try {
    credentials = getCredentials();
  } catch (error) {
    console.error(`錯誤：${error.message}`);
    process.exit(1);
  }
  console.log(`目標：${pending.length} 杯無實照配方（桶：${BUCKET_NAME}、來源：TheCocktailDB）`);

  try {
    await ensureBucket(credentials);
  } catch (error) {
    console.error(`錯誤：${error.message}`);
    process.exit(1);
  }

  // 既有 photo-map 為底（IBA 回填的條目原樣保留）；本腳本只新增 tcdb 條目。
  const existingPhotos = readPhotoMap(PHOTO_MAP_PATH)?.photos ?? {};

  for (const recipe of pending) {
    try {
      const result = await processTcdbRecipe(credentials, recipe);
      if (result.status !== 'failed') {
        // uploaded 與 skipped 都補條目（與 fetch-iba-photos 一致）：
        // skipped 代表遠端物件健在（多半是舊 photo-map 遺失條目時的重跑），
        // 若只回補 uploaded，這批物件會永遠沒有條目可被應用引用。
        // 查無對應（failed）不寫，避免指向不存在的物件。
        existingPhotos[recipe.id] = {
          url: publicPhotoUrl(credentials.supabaseUrl, recipe.id),
          source: 'tcdb',
        };
        if (result.status === 'uploaded') {
          stats.success.push(recipe.id);
        } else {
          stats.skipped.push(recipe.id);
        }
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

  console.log('=== TheCocktailDB 示意照片補抓完成 ===');
  console.log(`成功：${stats.success.length} 杯、跳過（遠端已存在）：${stats.skipped.length} 杯、失敗：${stats.failed.length} 杯`);
  if (stats.success.length > 0) console.log(`成功清單：${stats.success.join('、')}`);
  for (const item of stats.warnings) console.log(`[警告] ${item}`);
  if (stats.failed.length > 0) {
    console.log('失敗清單（不寫入 photo-map）：');
    for (const item of stats.failed) console.log(`  - ${item}`);
  }
  console.log(`photo-map 已寫入：${path.relative(ROOT_DIR, PHOTO_MAP_PATH)}`);
}

// 直接以 node 執行才跑主流程；被測試 import 時不執行（純匯出供測）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
