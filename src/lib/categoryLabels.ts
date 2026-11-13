/**
 * 食材分類的顯示層常數。
 *
 * 分類的中文名稱與顯示順序屬於介面文案，Supabase 資料庫未儲存此資訊，
 * 因此寫死在前端一份常數；分類 id 與建置產物 ingredients.json 的
 * categories 一致，getCategories() 以此為單一來源，避免兩種資料來源
 * （Supabase／靜態 JSON）各自的 categories 內容漂移。
 */
import type { IngredientCategory } from './types';

/** 單一分類的顯示資訊。 */
export interface CategoryLabelEntry {
  /** 分類 id。 */
  id: IngredientCategory;
  /** 中文名稱。 */
  zh: string;
  /** 顯示順序，數字越小越前面。 */
  order: number;
}

/** 全部分類的中文名稱與顯示順序，已依 order 由小到大排序。 */
export const CATEGORY_LABELS: readonly CategoryLabelEntry[] = [
  { id: 'base-spirit', zh: '基酒', order: 1 },
  { id: 'fortified-wine', zh: '加強葡萄酒', order: 2 },
  { id: 'liqueur', zh: '利口酒/香甜酒', order: 3 },
  { id: 'syrup', zh: '糖漿/甜味劑', order: 4 },
  { id: 'bitter', zh: '苦精', order: 5 },
  { id: 'mixer', zh: '氣泡水/飲料/果汁', order: 6 },
  { id: 'dairy', zh: '乳類/蛋', order: 7 },
  { id: 'wine', zh: '葡萄酒/香檳', order: 8 },
  { id: 'tea-coffee', zh: '茶/咖啡', order: 9 },
  { id: 'garnish', zh: '裝飾/配料', order: 10 },
];
