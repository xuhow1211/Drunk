/**
 * 靜態資料檔的載入器。
 *
 * 建置腳本（scripts/build-data.mjs）會把配方與食材資料輸出到
 * public/data/*.json，由 CDN 快取；JS bundle 不再內嵌資料內容。
 * runtime 以 fetch 取得兩份檔案後，交由 dataStore 注入各模組索引。
 */
import type { CocktailDataset, IngredientCatalog } from './types';

/** 單次載入的結果：配方資料集與食材對照表。 */
export interface LoadedData {
  /** 配方資料集（public/data/cocktails.json）。 */
  dataset: CocktailDataset;
  /** 食材對照表（public/data/ingredients.json）。 */
  catalog: IngredientCatalog;
}

/** 最基本的資料形狀檢查；形狀不符代表建置產物損壞，應走錯誤路徑。 */
function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 讀取單一 JSON 資源。
 *
 * HTTP 回應非 2xx 或 JSON 解析失敗一律拋出例外，由呼叫端決定降級方式。
 *
 * @param url 資源網址
 * @param label 錯誤訊息中標示資料的用語
 */
async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label}載入失敗（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}

/**
 * 載入建置產物的靜態資料（public/data 下兩份 JSON），兩者並行請求。
 *
 * @returns 配方資料集與食材對照表；任一檔案不可用時拋出例外
 */
export async function loadStaticData(): Promise<LoadedData> {
  const [dataset, catalog] = await Promise.all([
    fetchJson<unknown>('/data/cocktails.json', '配方資料'),
    fetchJson<unknown>('/data/ingredients.json', '食材對照表'),
  ]);

  if (!isPlainObject(dataset) || !Array.isArray((dataset as CocktailDataset).recipes)) {
    throw new Error('配方資料的格式不正確');
  }
  if (
    !isPlainObject(catalog) ||
    !Array.isArray((catalog as IngredientCatalog).ingredients) ||
    !Array.isArray((catalog as IngredientCatalog).substitutions)
  ) {
    throw new Error('食材對照表的格式不正確');
  }

  return { dataset: dataset as CocktailDataset, catalog: catalog as IngredientCatalog };
}
