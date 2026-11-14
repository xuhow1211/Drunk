/**
 * 杯型插畫對應的單元測試。
 *
 * 驗證三件事：
 * 1. GlassType 的全部成員各屬三大家族之一（以家族代表互異性驗證——
 *    插畫資產在測試與建置環境可能被 Vite 內嵌成 data URI，故不比對檔名）；
 * 2. 未知杯型值會回退高球杯插畫，不會拋出錯誤或回傳 undefined；
 * 3. 建置產物（src/data/cocktails.json）實際出現的每個 glass 值都有對應，
 *    涵蓋資料的完整值域。
 */
import { describe, expect, it } from 'vitest';
import cocktailsJson from '../data/cocktails.json';
import { glassIllustrationUrl } from './glassIllustration';
import type { GlassType } from './types';

/** 代表圖：glass-coupe 的網址（data URI 或檔案路徑，視建置內嵌而定）。 */
const coupeUrl = glassIllustrationUrl('coupe');
/** glass-rocks 的網址。 */
const rocksUrl = glassIllustrationUrl('rocks');
/** glass-highball 的網址。 */
const highballUrl = glassIllustrationUrl('highball');

/** 判斷網址是否為合法的 SVG 資產（檔案路徑或 data URI 內嵌）。 */
function isSvgAsset(url: string): boolean {
  return url.endsWith('.svg') || url.startsWith('data:image/svg+xml');
}

describe('glassIllustrationUrl 家族對應', () => {
  it('三大家族的代表插畫互異', () => {
    expect(isSvgAsset(coupeUrl)).toBe(true);
    expect(isSvgAsset(rocksUrl)).toBe(true);
    expect(isSvgAsset(highballUrl)).toBe(true);
    expect(new Set([coupeUrl, rocksUrl, highballUrl]).size).toBe(3);
  });

  it('淺口杯家族（coupe／martini／nick-nora／wine）對應 glass-coupe', () => {
    for (const glass of ['coupe', 'martini', 'nick-nora', 'wine'] as GlassType[]) {
      expect(glassIllustrationUrl(glass)).toBe(coupeUrl);
    }
  });

  it('矮直筒杯家族（rocks／tumbler／shot）對應 glass-rocks', () => {
    for (const glass of ['rocks', 'tumbler', 'shot'] as GlassType[]) {
      expect(glassIllustrationUrl(glass)).toBe(rocksUrl);
    }
  });

  it('高瘦杯家族（highball／collins／flute／mug／other）對應 glass-highball', () => {
    for (const glass of ['highball', 'collins', 'flute', 'mug', 'other'] as GlassType[]) {
      expect(glassIllustrationUrl(glass)).toBe(highballUrl);
    }
  });

  it('來源出現未知杯型時回退 glass-highball，不會拋出錯誤或回傳 undefined', () => {
    const unknownGlass = 'pint' as unknown as GlassType;
    expect(glassIllustrationUrl(unknownGlass)).toBe(highballUrl);
  });
});

describe('建置產物的 glass 值域涵蓋', () => {
  it('cocktails.json 中每個實際出現的杯型都對應到三張插畫之一', () => {
    const glassValues = [...new Set(cocktailsJson.recipes.map((recipe) => recipe.glass))];
    expect(glassValues.length).toBeGreaterThan(0);
    for (const glass of glassValues) {
      const url = glassIllustrationUrl(glass as GlassType);
      expect(isSvgAsset(url)).toBe(true);
      expect([coupeUrl, rocksUrl, highballUrl]).toContain(url);
    }
  });
});
