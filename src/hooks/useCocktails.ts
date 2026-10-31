/**
 * 配方與食材資料的載入 hook。
 *
 * 本專案採靜態部署，配方與對照表在建置階段已打包成 JSON，
 * 因此直接以 import 引入即可使用，不需要 fetch、不需要後端。
 */
import { useMemo } from 'react';
import cocktailData from '../data/cocktails.json';
import ingredientData from '../data/ingredients.json';
import type { CocktailDataset, Ingredient, IngredientCatalog, Recipe } from '../lib/types';

const dataset = cocktailData as unknown as CocktailDataset;
const catalog = ingredientData as unknown as IngredientCatalog;

/** useCocktails 的回傳內容。 */
export interface UseCocktailsResult {
  /** 全部配方。 */
  recipes: Recipe[];
  /** 全部食材（統一對照表）。 */
  ingredients: Ingredient[];
  /** 依配方 id 建立的索引，供快速查找。 */
  byId: Map<string, Recipe>;
  /** 是否載入中。靜態資料恆為 false。 */
  loading: boolean;
  /** 載入錯誤。靜態資料恆為 null。 */
  error: Error | null;
}

/**
 * 取得配方與食材資料，並建立 id 索引。
 *
 * 資料為建置階段產生的靜態 JSON，因此載入必定成功；
 * 保留 loading 與 error 欄位讓介面有統一的載入狀態處理方式。
 */
export function useCocktails(): UseCocktailsResult {
  const recipes = useMemo(() => dataset.recipes, []);
  const ingredients = useMemo(() => catalog.ingredients, []);
  const byId = useMemo(
    () => new Map(recipes.map((recipe) => [recipe.id, recipe])),
    [recipes],
  );

  return {
    recipes,
    ingredients,
    byId,
    loading: false,
    error: null,
  };
}
