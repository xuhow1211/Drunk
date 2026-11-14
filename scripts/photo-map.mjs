/**
 * join 這麼喝：示意照片索引（photo-map）的讀取與套用。
 *
 * data/photo-map.json 由 scripts/fetch-iba-photos.mjs 產出，形狀：
 *   { generatedAt: ISO 時間戳記, photos: { [配方 id]: { url: 照片公開網址 } } }
 *
 * 檔案不存在、解析失敗或形狀不符時一律回傳 null（整體視為無照片）：
 * 示意照片是選用強化，缺檔不該阻斷建置，產物只是不出現 photoUrl 欄位，
 * 前端改以杯型插畫替代。此「缺失容忍」的對應規則由 src/lib/photoMap.test.ts 直接驗證。
 *
 * 本檔刻意保持純 Node 內建模組、不執行任何動作（無 main），
 * 供 scripts/build-data.mjs 與 scripts/seed-supabase.mjs 共用。
 */

import fs from 'node:fs';

/**
 * 讀取 photo-map 檔。
 *
 * @param {string} filePath data/photo-map.json 的完整路徑
 * @returns {object | null} 解析後的 photo-map；不存在、解析失敗或形狀不符時為 null
 */
export function readPhotoMap(filePath) {
  if (!fs.existsSync(filePath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.photos !== 'object' ||
    parsed.photos === null ||
    Array.isArray(parsed.photos)
  ) {
    return null;
  }
  return parsed;
}

/**
 * 把 photo-map 的照片網址套到配方上。
 *
 * 規則：僅對「條目存在且 url 為合法 https 網址」的配方加上 photoUrl 欄位；
 * 其餘配方不動（不會出現值為 undefined 的空欄位，與既有 JSON 形狀慣例一致）。
 *
 * @param {object[]} recipes 正規化後的配方清單（就地修改）
 * @param {object | null} photoMap readPhotoMap 的結果
 * @param {{ onInvalid?: (recipeId: string, url: string) => void }} [callbacks]
 *   onInvalid：url 存在但非 https 時被呼叫（不套用）
 * @returns {number} 實際套上 photoUrl 的杯數
 */
export function applyPhotoMap(recipes, photoMap, callbacks = {}) {
  if (!photoMap) return 0;
  let applied = 0;
  for (const recipe of recipes) {
    const entry = photoMap.photos[recipe.id];
    const url = entry && typeof entry.url === 'string' ? entry.url : null;
    if (!url) continue;
    if (!url.startsWith('https://')) {
      callbacks.onInvalid?.(recipe.id, url);
      continue;
    }
    recipe.photoUrl = url;
    applied += 1;
  }
  return applied;
}
