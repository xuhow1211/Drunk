/**
 * 統一食材對照表的查詢與索引。
 *
 * 資料來自建置腳本產生的 src/data/ingredients.json（靜態打包，無需網路請求）。
 * 啟動時即建立索引，讓介面在每次勾選材料時都能即時查詢。
 */
import catalogJson from '../data/ingredients.json';
import type { Ingredient, IngredientCategory, Substitution } from './types';

const catalog = catalogJson as unknown as {
  version: string;
  categories: Record<string, { zh: string; order: number }>;
  ingredients: Ingredient[];
  substitutions: Substitution[];
};

/** 食材 id 索引。 */
const ingredientIndex = new Map<string, Ingredient>(
  catalog.ingredients.map((ingredient) => [ingredient.id, ingredient]),
);

/**
 * 替代規則索引：被替代的食材 id → 可替代它的規則清單。
 *
 * 一次建立即可避免每次比對都掃描整個 substitutions 陣列。
 */
const substitutionIndex = new Map<string, Substitution[]>();
for (const substitution of catalog.substitutions) {
  const existing = substitutionIndex.get(substitution.from);
  if (existing) {
    existing.push(substitution);
  } else {
    substitutionIndex.set(substitution.from, [substitution]);
  }
}

/** 分類索引：分類 → 該分類的食材清單。 */
const categoryIndex = new Map<string, Ingredient[]>();
for (const ingredient of catalog.ingredients) {
  const existing = categoryIndex.get(ingredient.category);
  if (existing) {
    existing.push(ingredient);
  } else {
    categoryIndex.set(ingredient.category, [ingredient]);
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

  const matched = catalog.ingredients.filter((ingredient) => {
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

/** 查詢可替代某食材的所有食材 id。 */
export function getSubstitutes(id: string): string[] {
  const rules = substitutionIndex.get(id);
  if (!rules) return [];
  return rules.flatMap((rule) => rule.to);
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
  return catalog.ingredients.filter((ingredient) => ingredient.common);
}

/** 取得全部分類的中文名稱與顯示順序。 */
export function getCategories(): { id: string; zh: string; order: number }[] {
  return Object.entries(catalog.categories)
    .map(([id, meta]) => ({ id, zh: meta.zh, order: meta.order }))
    .sort((a, b) => a.order - b.order);
}

/** 取得對照表版本號，供介面顯示資料版本。 */
export function getCatalogVersion(): string {
  return catalog.version;
}
