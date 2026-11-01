/**
 * 介面格式化與對照表的單元測試。
 *
 * 重點是「介面不會漏出英文」：資料集裡的 category、glass、flavor 都是英文原始值，
 * 若對照表漏收，使用者就會在繁中介面上直接看到 shooter、fizz、shot 這類字串。
 * 因此本檔以真實資料逐筆檢查，確保每個值都有繁中標籤。
 */
import { describe, expect, it } from 'vitest';
import cocktailData from '../data/cocktails.json';
import type { CocktailDataset } from './types';
import {
  DIFFICULTY_LABELS,
  FLAVOR_LABELS,
  GLASS_LABELS,
  RECIPE_CATEGORY_HUES,
  RECIPE_CATEGORY_LABELS,
  difficultyLabel,
  parseAbv,
  parseMinutes,
} from './format';

const recipes = (cocktailData as unknown as CocktailDataset).recipes;

/** 是否含有中文（繁體）字元。 */
function hasChinese(text: string): boolean {
  return /[一-鿿]/.test(text);
}

describe('調酒類型標籤', () => {
  it('真實資料中的每個分類都有繁中標籤，且標籤不是原始英文值', () => {
    const seen = new Set<string>();

    for (const recipe of recipes) {
      seen.add(recipe.category);
      const label = RECIPE_CATEGORY_LABELS[recipe.category];
      expect(label, `${recipe.id} 的分類 ${recipe.category} 缺少標籤`).toBeDefined();
      expect(hasChinese(label), `${recipe.id} 的分類標籤應含中文`).toBe(true);
    }

    expect(seen.size).toBeGreaterThan(0);
  });

  it('先前漏收的分類（shooter、fizz）已補上繁中標籤與色相', () => {
    expect(RECIPE_CATEGORY_LABELS.shooter).toBe('一口飲 Shooter');
    expect(RECIPE_CATEGORY_LABELS.fizz).toBe('打氣調飲 Fizz');
    expect(RECIPE_CATEGORY_HUES.shooter).toBeTypeOf('number');
    expect(RECIPE_CATEGORY_HUES.fizz).toBeTypeOf('number');
  });

  it('每個分類都有對應的色相', () => {
    for (const category of Object.keys(RECIPE_CATEGORY_LABELS)) {
      const hue = RECIPE_CATEGORY_HUES[category as keyof typeof RECIPE_CATEGORY_HUES];
      expect(hue, `${category} 缺少色相`).toBeTypeOf('number');
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(360);
    }
  });
});

describe('杯型標籤', () => {
  it('真實資料中的每個杯型都有繁中標籤', () => {
    for (const recipe of recipes) {
      const label = GLASS_LABELS[recipe.glass];
      expect(label, `${recipe.id} 的杯型 ${recipe.glass} 缺少標籤`).toBeDefined();
      expect(hasChinese(label), `${recipe.id} 的杯型標籤應含中文`).toBe(true);
    }
  });

  it('先前漏收的 shot 杯型已補上繁中標籤', () => {
    expect(GLASS_LABELS.shot).toBe('一口杯');
  });
});

describe('風味標籤', () => {
  it('真實資料中的每個風味都有繁中標籤', () => {
    for (const recipe of recipes) {
      for (const flavor of recipe.flavor) {
        const label = FLAVOR_LABELS[flavor];
        expect(label, `${recipe.id} 的風味 ${flavor} 缺少標籤`).toBeDefined();
        if (label === undefined) continue;
        expect(hasChinese(label), `${recipe.id} 的風味標籤應含中文`).toBe(true);
      }
    }
  });
});

describe('難度標籤', () => {
  it('難度 1 至 3 都有對應的中文標示', () => {
    expect(DIFFICULTY_LABELS).toHaveLength(3);
    expect(difficultyLabel(1)).toBe('簡單');
    expect(difficultyLabel(2)).toBe('中等');
    expect(difficultyLabel(3)).toBe('進階');
  });

  it('超出範圍的難度會收斂到最接近的級距', () => {
    expect(difficultyLabel(0)).toBe('簡單');
    expect(difficultyLabel(-3)).toBe('簡單');
    expect(difficultyLabel(9)).toBe('進階');
  });
});

describe('parseAbv', () => {
  it('可解析的格式回傳數值', () => {
    expect(parseAbv('約 22%')).toBe(22);
    expect(parseAbv('0%')).toBe(0);
  });

  it('負數、超範圍、空字串與非數字一律回傳 null', () => {
    expect(parseAbv('-5%')).toBeNull();
    expect(parseAbv('120%')).toBeNull();
    expect(parseAbv('')).toBeNull();
    expect(parseAbv('不明')).toBeNull();
  });
});

describe('parseMinutes', () => {
  it('可解析的格式回傳整數分鐘', () => {
    expect(parseMinutes('4 分鐘')).toBe(4);
    expect(parseMinutes('0 分鐘')).toBe(0);
  });

  it('負數、空字串與非數字一律回傳 null', () => {
    expect(parseMinutes('-5 分鐘')).toBeNull();
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('隨手調')).toBeNull();
  });
});
