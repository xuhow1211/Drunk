/**
 * Vitest 共用 setup：把建置產物的食材對照表注入同步索引。
 *
 * ingredients 模組改為注入式後，同步查詢 API 需先注入對照表才會有內容；
 * 各邏輯測試一律使用真實的建置產物（src/data/ingredients.json）初始化，
 * 維持原本「以真實資料驗證邏輯」的測試寫法。
 */
import catalogJson from '../data/ingredients.json';
import { setIngredientCatalog } from '../lib/ingredients';
import type { IngredientCatalog } from '../lib/types';

setIngredientCatalog(catalogJson as unknown as IngredientCatalog);
