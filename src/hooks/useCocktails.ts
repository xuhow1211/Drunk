/**
 * 配方與食材資料的載入 hook。
 *
 * 資料由啟動時的載入流程（dataStore）以 fetch 取得，並以
 * useSyncExternalStore 訂閱載入狀態：就緒前回傳空清單且 loading 為 true，
 * 就緒後立即有完整內容。索引層的同步查詢（ingredients 模組）另由
 * 資料層在就緒時注入，本 hook 不負責索引。
 */
import { useMemo, useSyncExternalStore } from 'react';
import { getDataState, subscribeDataState } from '../lib/dataStore';
import type { Ingredient, Recipe } from '../lib/types';

/** 資料尚未就緒時回傳的共用空清單（保持參數穩定，避免不必要的重算）。 */
const EMPTY_RECIPES: Recipe[] = [];
const EMPTY_INGREDIENTS: Ingredient[] = [];

/** useCocktails 的回傳內容。 */
export interface UseCocktailsResult {
  /** 全部配方。資料尚未就緒時為空清單。 */
  recipes: Recipe[];
  /** 全部食材（統一對照表）。資料尚未就緒時為空清單。 */
  ingredients: Ingredient[];
  /** 依配方 id 建立的索引，供快速查找。 */
  byId: Map<string, Recipe>;
  /** 是否載入中。 */
  loading: boolean;
  /** 載入錯誤；成功前為 null。 */
  error: Error | null;
}

/**
 * 取得配方與食材資料，並建立 id 索引。
 *
 * 資料就緒前回傳空清單與 loading 狀態，呼叫端應據此顯示載入或錯誤畫面；
 * 資料就緒時 loading 轉為 false，所有回傳值同步有內容。
 */
export function useCocktails(): UseCocktailsResult {
  const state = useSyncExternalStore(subscribeDataState, getDataState);
  const recipes = state.dataset?.recipes ?? EMPTY_RECIPES;
  const ingredients = state.catalog?.ingredients ?? EMPTY_INGREDIENTS;
  const byId = useMemo(
    () => new Map(recipes.map((recipe) => [recipe.id, recipe])),
    [recipes],
  );

  return {
    recipes,
    ingredients,
    byId,
    loading: state.loading,
    error: state.error,
  };
}
