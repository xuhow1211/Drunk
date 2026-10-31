/**
 * 瀏覽模式系列篩選的單元測試（使用真實資料）。
 *
 * 測試重點是跨來源整併後的 collections 契約：
 * 同一杯酒可能同時屬於多個系列（既是 IBA 經典也是票選熱門），
 * 系列篩選必須檢查 collections 陣列，且材料不得少於任一來源版本。
 */
import { describe, expect, it } from 'vitest';
import cocktailData from '../data/cocktails.json';
import ibaSource from '../../data/iba-classics.json';
import popularSource from '../../data/popular-modern.json';
import type { CocktailDataset, Recipe } from './types';
import { DEFAULT_FILTERS, filterRecipes, getRecipeCollections } from './filters';

const recipes = (cocktailData as unknown as CocktailDataset).recipes;

/** 篩選不需要食材中文名對照（只測系列條件），故使用空對照表。 */
const ingredientNames = new Map<string, string>();

/** 原始來源中指定配方的材料數。 */
function sourceIngredientCount(
  source: { recipes: { id: string; ingredients: unknown[] }[] },
  id: string,
): number | null {
  const recipe = source.recipes.find((item) => item.id === id);
  return recipe ? recipe.ingredients.length : null;
}

/** 依 id 取得真實配方。 */
function recipeById(id: string): Recipe {
  const recipe = recipes.find((item) => item.id === id);
  if (!recipe) throw new Error(`測試資料中找不到配方：${id}`);
  return recipe;
}

describe('系列篩選（collections 契約）', () => {
  it('熱門系列 141 杯、經典系列合計 102 杯', () => {
    const popular = filterRecipes(recipes, DEFAULT_FILTERS, ingredientNames, {
      collections: ['popular'],
    });
    const classic = filterRecipes(recipes, DEFAULT_FILTERS, ingredientNames, {
      collections: ['classic', 'new-era'],
    });

    expect(popular).toHaveLength(141);
    expect(classic).toHaveLength(102);
  });

  it('未指定系列時不做系列篩選', () => {
    const all = filterRecipes(recipes, DEFAULT_FILTERS, ingredientNames);
    expect(all).toHaveLength(recipes.length);
  });

  it('跨來源重複的配方同時屬於兩個系列', () => {
    const samples = [
      'sazerac',
      'pisco-sour',
      'margarita',
      'pina-colada',
      'negroni',
      'old-fashioned',
      'moscow-mule',
      'manhattan',
      'mai-tai',
      'last-word',
    ];

    for (const id of samples) {
      const recipe = recipeById(id);
      expect(recipe.collections, `${id} 應同時屬於 classic 與 popular`).toContain('classic');
      expect(recipe.collections, `${id} 應同時屬於 classic 與 popular`).toContain('popular');
      expect(recipe.collection).toBe(recipe.collections[0]);
    }
  });

  it('整併後的材料不少於任一來源版本', () => {
    const samples = [
      'sazerac',
      'pisco-sour',
      'margarita',
      'pina-colada',
      'negroni',
      'old-fashioned',
      'moscow-mule',
      'manhattan',
      'mai-tai',
      'last-word',
    ];

    for (const id of samples) {
      const recipe = recipeById(id);
      const ibaCount = sourceIngredientCount(ibaSource, id);
      const popularCount = sourceIngredientCount(popularSource, id);

      expect(recipe.ingredients.length, `${id} 的材料數`).toBeGreaterThanOrEqual(
        Math.max(ibaCount ?? 0, popularCount ?? 0),
      );
    }
  });

  it('缺少 collections 欄位的舊資料退回使用單一 collection', () => {
    const legacy = {
      id: 'legacy',
      collection: 'popular',
    } as unknown as Recipe;

    expect(getRecipeCollections(legacy)).toEqual(['popular']);
  });
});
