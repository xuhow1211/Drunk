/**
 * 統一食材對照表的查詢與索引。
 *
 * 資料由啟動時的載入流程（dataStore）注入：對照表就緒前，
 * 同步查詢 API 一律回傳空結果（不拋出例外）；就緒後立即有完整索引。
 * 介面各處（比對引擎、篩選、材料選擇器）皆以同步方式呼叫本模組。
 */
import { CATEGORY_LABELS, type CategoryLabelEntry } from './categoryLabels';
import type { Ingredient, IngredientCatalog, IngredientCategory, Substitution } from './types';

/** 對照表內的全部食材（尚未注入時為空陣列）。 */
let allIngredients: Ingredient[] = [];

/** 食材 id 索引。 */
const ingredientIndex = new Map<string, Ingredient>();

/**
 * 替代規則索引：被替代的食材 id → 可替代它的規則清單。
 *
 * 一次建立即可避免每次比對都掃描整個 substitutions 陣列。
 */
const substitutionIndex = new Map<string, Substitution[]>();

/** 分類索引：分類 → 該分類的食材清單。 */
const categoryIndex = new Map<string, Ingredient[]>();

/**
 * 注入食材對照表並重建各索引。
 *
 * 由資料載入流程在對照表就緒時呼叫；重複注入以最後一次為準。
 *
 * @param catalog 建置產物或 Supabase 對應後的食材對照表
 */
export function setIngredientCatalog(catalog: IngredientCatalog): void {
  ingredientIndex.clear();
  substitutionIndex.clear();
  categoryIndex.clear();

  allIngredients = catalog.ingredients;
  for (const ingredient of catalog.ingredients) {
    ingredientIndex.set(ingredient.id, ingredient);
    const existing = categoryIndex.get(ingredient.category);
    if (existing) {
      existing.push(ingredient);
    } else {
      categoryIndex.set(ingredient.category, [ingredient]);
    }
  }

  for (const substitution of catalog.substitutions) {
    const existing = substitutionIndex.get(substitution.from);
    if (existing) {
      existing.push(substitution);
    } else {
      substitutionIndex.set(substitution.from, [substitution]);
    }
  }
}

/** 查詢單一食材；找不到時回傳 undefined。 */
export function getIngredient(id: string): Ingredient | undefined {
  return ingredientIndex.get(id);
}

/**
 * 依關鍵字搜尋食材，比對中文名稱、英文名稱、別名與 id。
 *
 * 命中開頭的結果排在前面，其餘依中文名稱排序，供材料選擇器的搜尋框使用。
 */
export function searchIngredients(query: string): Ingredient[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [];

  const matched = allIngredients.filter((ingredient) => {
    if (ingredient.id.toLowerCase().includes(keyword)) return true;
    if (ingredient.zh.toLowerCase().includes(keyword)) return true;
    if (ingredient.en.toLowerCase().includes(keyword)) return true;
    return ingredient.aliases.some((alias) => alias.toLowerCase().includes(keyword));
  });

  return matched.sort((a, b) => {
    const aStarts = a.zh.startsWith(keyword) || a.en.toLowerCase().startsWith(keyword);
    const bStarts = b.zh.startsWith(keyword) || b.en.toLowerCase().startsWith(keyword);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.zh.localeCompare(b.zh, 'zh-Hant');
  });
}

/** 取得替代規則索引（被替代的食材 id → 規則清單），避免重複掃描。 */
export function getSubstitutionMap(): Map<string, Substitution[]> {
  return substitutionIndex;
}

/** 依分類取得食材清單。 */
export function getByCategory(category: IngredientCategory | string): Ingredient[] {
  return categoryIndex.get(category) ?? [];
}

/** 取得常備食材（台灣便利商店等處容易取得的品項），供快捷選取區使用。 */
export function getCommonIngredients(): Ingredient[] {
  return allIngredients.filter((ingredient) => ingredient.common);
}

/**
 * 取得全部分類的中文名稱與顯示順序。
 *
 * 分類名稱與順序屬於介面顯示層資訊，直接來自 categoryLabels 常數，
 * 與資料來源（Supabase 或靜態 JSON）無關。
 */
export function getCategories(): CategoryLabelEntry[] {
  return CATEGORY_LABELS.map(({ id, zh, order }) => ({ id, zh, order }));
}
