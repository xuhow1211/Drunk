/**
 * photo-map（示意照片索引）讀取與套用的單元測試。
 *
 * 邏輯實作在 scripts/photo-map.mjs（建置腳本層，Node 無法直接執行 TS），
 * 測試由此檔引用；驗證重點為缺失容忍（檔案不存在、解析失敗、形狀不符
 * 一律視為整體無照片）與套用規則（僅 https 網址、無條目者不出現欄位）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// 防線說明：建置腳本層為 .mjs（純 Node 執行），tsc 無對應型別宣告，故壓制 TS2307。
// @ts-expect-error 建置腳本層 .mjs 僅供測試引用
import { applyPhotoMap, readPhotoMap } from '../../scripts/photo-map.mjs';

/** 套用 photoUrl 後的配方形狀（測試端僅使用 photoUrl 欄位）。 */
interface RecipeWithPhoto {
  id: string;
  photoUrl?: string;
}

/** 在暫存目錄寫入指定內容並回傳檔案路徑。 */
function writeTempFile(content: string) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'photo-map-test-')), 'photo-map.json');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** 產生一筆只有 id 等基本欄位的最小配方物件（不含 photoUrl 欄位，供 `in` 檢查）。 */
function recipeWith(id: string): RecipeWithPhoto {
  const recipe: Record<string, unknown> = { id, nameEn: 'Test' };
  return recipe as unknown as RecipeWithPhoto;
}

/** 以斷言確保索引元素存在（noUncheckedIndexedAccess）。 */
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`清單索引 ${index} 不存在（測試資料錯誤）`);
  }
  return item;
}

describe('readPhotoMap 缺失容忍', () => {
  it('檔案不存在時回傳 null（整體視為無照片）', () => {
    expect(readPhotoMap(path.join(os.tmpdir(), 'photo-map-not-exist.json'))).toBeNull();
  });

  it('JSON 解析失敗時回傳 null，不拋出例外', () => {
    expect(readPhotoMap(writeTempFile('{ 這不是 JSON'))).toBeNull();
  });

  it('形狀不符（缺 photos 或 photos 非物件）時回傳 null', () => {
    expect(readPhotoMap(writeTempFile(JSON.stringify({ generatedAt: 'x' })))).toBeNull();
    expect(readPhotoMap(writeTempFile(JSON.stringify({ photos: [] })))).toBeNull();
  });

  it('合法形狀時回傳解析後的物件', () => {
    const map = { generatedAt: 'x', photos: { negroni: { url: 'https://example.com/n.webp' } } };
    expect(readPhotoMap(writeTempFile(JSON.stringify(map)))).toEqual(map);
  });
});

describe('applyPhotoMap 套用規則', () => {
  it('photoMap 為 null（缺檔）時不動任何配方', () => {
    const recipes = [recipeWith('negroni')];
    expect(applyPhotoMap(recipes, null)).toBe(0);
    expect('photoUrl' in at(recipes, 0)).toBe(false);
  });

  it('有條目者加上 photoUrl，無條目者不會出現空欄位', () => {
    const recipes = [recipeWith('negroni'), recipeWith('seed-clip')];
    const photoMap = { generatedAt: 'x', photos: { negroni: { url: 'https://example.com/n.webp' } } };
    expect(applyPhotoMap(recipes, photoMap)).toBe(1);
    expect(at(recipes, 0).photoUrl).toBe('https://example.com/n.webp');
    expect('photoUrl' in at(recipes, 1)).toBe(false);
  });

  it('非 https 的網址不套用，並以 onInvalid 回報', () => {
    const recipes = [recipeWith('suspicious')];
    const photoMap = { generatedAt: 'x', photos: { suspicious: { url: 'http://example.com/s.webp' } } };
    const invalids: string[] = [];
    expect(
      applyPhotoMap(recipes, photoMap, {
        onInvalid: (recipeId: string, url: string) => invalids.push(`${recipeId}:${url}`),
      }),
    ).toBe(0);
    expect(invalids).toEqual(['suspicious:http://example.com/s.webp']);
    expect('photoUrl' in at(recipes, 0)).toBe(false);
  });

  it('url 非字串的條目一律忽略', () => {
    const recipes = [recipeWith('broken')];
    const photoMap = { generatedAt: 'x', photos: { broken: { url: 123 } } };
    expect(applyPhotoMap(recipes, photoMap)).toBe(0);
    expect('photoUrl' in at(recipes, 0)).toBe(false);
  });
});
