/**
 * 瀏覽模式（經典調酒／熱門推薦）的篩選與排序邏輯。
 *
 * 純函式設計：篩選條件與排序皆由外部傳入，方便介面以 useMemo 快取，
 * 也讓排序結果可被其他元件重複使用。
 */
import { getMaterialCount } from './matching';
import { parseAbv, parseMinutes } from './format';
import type { Collection, Recipe, RecipeCategory } from './types';

/** 排序方式。 */
export type SortKey = 'popularity' | 'name' | 'materials' | 'difficulty' | 'abv' | 'time';

/** 篩選列的完整狀態。 */
export interface FilterState {
  /** 調酒類型（recipe.category）多選。 */
  categories: RecipeCategory[];
  /** 風味標籤（recipe.flavor）多選。 */
  flavors: string[];
  /** 場合標籤（recipe.occasion）多選。 */
  occasions: string[];
  /** 難度多選（1 至 3）。 */
  difficulties: number[];
  /** 酒精濃度下限（百分比）；null 代表不設下限。 */
  abvMin: number | null;
  /** 酒精濃度上限（百分比）；null 代表不設上限。 */
  abvMax: number | null;
  /** 搜尋關鍵字（中英文名、別名、原料名稱）。 */
  query: string;
  /** 排序方式。 */
  sort: SortKey;
}

/** 篩選列的預設狀態（等同於「重設篩選」）。 */
export const DEFAULT_FILTERS: FilterState = {
  categories: [],
  flavors: [],
  occasions: [],
  difficulties: [],
  abvMin: null,
  abvMax: null,
  query: '',
  sort: 'popularity',
};

/** 篩選列可用的排序選項。 */
export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'popularity', label: '熱門度優先' },
  { value: 'name', label: '名稱排序' },
  { value: 'materials', label: '材料數由少到多' },
  { value: 'difficulty', label: '難度由低到高' },
  { value: 'abv', label: '酒精度由高到低' },
  { value: 'time', label: '製作時間由快到慢' },
];

/** 篩選列可用的篩選面向。 */
export interface FilterFacets {
  /** 可選的調酒類型。 */
  categories: RecipeCategory[];
  /** 可選的風味標籤。 */
  flavors: string[];
  /** 可選的場合標籤。 */
  occasions: string[];
}

/**
 * 蒐集一份配方集合中出現過的篩選面向，供篩選列產生選項。
 *
 * @param recipes 待分析的配方
 */
export function collectFacets(recipes: readonly Recipe[]): FilterFacets {
  const categories = new Set<RecipeCategory>();
  const flavors = new Set<string>();
  const occasions = new Set<string>();

  for (const recipe of recipes) {
    categories.add(recipe.category);
    for (const flavor of recipe.flavor) flavors.add(flavor);
    for (const occasion of recipe.occasion) occasions.add(occasion);
  }

  return {
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    flavors: [...flavors].sort((a, b) => a.localeCompare(b)),
    occasions: [...occasions].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
  };
}

/**
 * 取得配方所屬的全部系列。
 *
 * 一杯酒可能同時屬於多個系列（例如既是 IBA 經典也是票選熱門），
 * 因此系列篩選必須檢查整個 collections 陣列，不能只看單一 collection。
 * 相容舊資料：若配方沒有 collections 欄位，退回使用單一 collection。
 *
 * @param recipe 待查詢的配方
 * @returns 配方所屬的全部系列
 */
export function getRecipeCollections(recipe: Recipe): readonly Collection[] {
  return recipe.collections?.length ? recipe.collections : [recipe.collection];
}

/** 篩選條件的額外限制。 */
export interface RecipeFilterOptions {
  /**
   * 只保留屬於這些系列的配方。
   *
   * 未指定或空陣列時不做系列篩選；比對時檢查配方的 collections 陣列。
   */
  collections?: readonly Collection[];
}

/**
 * 依關鍵字比對配方。
 *
 * 比對範圍包含中英文名稱、別名、調酒類型與原料中文名，
 * 讓使用者可以直接輸入「琴酒」找到所有用到琴酒的調酒。
 */
function matchesQuery(recipe: Recipe, keyword: string, ingredientNames: Map<string, string>): boolean {
  if (recipe.nameZh.toLowerCase().includes(keyword)) return true;
  if (recipe.nameEn.toLowerCase().includes(keyword)) return true;
  if (recipe.aliases.some((alias) => alias.toLowerCase().includes(keyword))) return true;
  if (recipe.category.toLowerCase().includes(keyword)) return true;
  return recipe.ingredientIds.some((id) => ingredientNames.get(id)?.toLowerCase().includes(keyword));
}

/**
 * 依篩選條件過濾配方。
 *
 * 酒精濃度區間的處理：只對「可解析出數值」的配方做區間比對；
 * 無法解析的配方不列入區間篩選，但仍會顯示在結果中（只是不保證落在區間內）。
 *
 * 系列篩選（options.collections）檢查配方的 collections 陣列，
 * 因此同時屬於多個系列的酒會出現在對應的每一個頁面。
 *
 * @param recipes 來源配方
 * @param filters 篩選條件
 * @param ingredientNames 食材 id → 中文名對照，供搜尋使用
 * @param options 額外限制（目前為系列篩選）
 */
export function filterRecipes(
  recipes: readonly Recipe[],
  filters: FilterState,
  ingredientNames: Map<string, string>,
  options: RecipeFilterOptions = {},
): Recipe[] {
  const keyword = filters.query.trim().toLowerCase();
  const hasAbvRange = filters.abvMin !== null || filters.abvMax !== null;
  const scopedCollections = options.collections;

  return recipes.filter((recipe) => {
    if (
      scopedCollections &&
      scopedCollections.length > 0 &&
      !scopedCollections.some((collection) =>
        getRecipeCollections(recipe).includes(collection),
      )
    ) {
      return false;
    }
    if (filters.categories.length > 0 && !filters.categories.includes(recipe.category)) {
      return false;
    }
    if (
      filters.flavors.length > 0 &&
      !recipe.flavor.some((flavor) => filters.flavors.includes(flavor))
    ) {
      return false;
    }
    if (
      filters.occasions.length > 0 &&
      !recipe.occasion.some((occasion) => filters.occasions.includes(occasion))
    ) {
      return false;
    }
    if (filters.difficulties.length > 0 && !filters.difficulties.includes(recipe.difficulty)) {
      return false;
    }
    if (hasAbvRange) {
      const abv = parseAbv(recipe.abv);
      if (abv !== null) {
        if (filters.abvMin !== null && abv < filters.abvMin) return false;
        if (filters.abvMax !== null && abv > filters.abvMax) return false;
      }
    }
    if (keyword && !matchesQuery(recipe, keyword, ingredientNames)) return false;
    return true;
  });
}

/**
 * 依指定方式排序配方。
 *
 * 所有排序都附加 id 當作最終比較鍵，確保結果順序穩定可預期；
 * 無法解析數值的配方（abv 或 time 不是合法數字）一律排在最後。
 *
 * @param recipes 待排序配方
 * @param sort 排序方式
 */
export function sortRecipes(recipes: readonly Recipe[], sort: SortKey): Recipe[] {
  const sorted = [...recipes];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.nameZh.localeCompare(b.nameZh, 'zh-Hant') || a.id.localeCompare(b.id);
      case 'materials':
        return getMaterialCount(a) - getMaterialCount(b) || a.id.localeCompare(b.id);
      case 'difficulty':
        return a.difficulty - b.difficulty || a.id.localeCompare(b.id);
      case 'abv': {
        const aAbv = parseAbv(a.abv);
        const bAbv = parseAbv(b.abv);
        if (aAbv === null && bAbv === null) return a.id.localeCompare(b.id);
        if (aAbv === null) return 1;
        if (bAbv === null) return -1;
        return bAbv - aAbv || a.id.localeCompare(b.id);
      }
      case 'time': {
        const aTime = parseMinutes(a.time);
        const bTime = parseMinutes(b.time);
        if (aTime === null && bTime === null) return a.id.localeCompare(b.id);
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        return aTime - bTime || a.id.localeCompare(b.id);
      }
      case 'popularity':
      default:
        return (
          b.popularity - a.popularity ||
          getMaterialCount(a) - getMaterialCount(b) ||
          a.id.localeCompare(b.id)
        );
    }
  });
  return sorted;
}
