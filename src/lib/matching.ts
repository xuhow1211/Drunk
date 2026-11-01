/**
 * 加權缺料比對引擎（核心演算法）。
 *
 * 核心概念：使用者勾選手邊已有的材料後，逐一比對每杯配方，算出「還缺什麼、缺得多嚴重」。
 * 分數越低代表越接近調得出來；分數完全相同時再依缺料數、熱門度與材料數排序。
 *
 * 設計重點：
 *   1. 依食材分類給予不同權重，缺基酒遠比缺飲料嚴重。
 *   2. 替代品不會讓缺料消失，只會依替代品質給予折扣並附上建議。
 *   3. 純函式、無副作用，資料來源為打包後的 JSON，適合直接單元測試。
 */
import { getIngredient, getSubstitutionMap } from './ingredients';
import {
  MIN_RETAINED_WEIGHT_RATIO,
  SUBSTITUTION_DISCOUNT_RATE,
  SUBSTITUTION_RETAINED_RATIO,
} from './types';
import type {
  IngredientCategory,
  MatchOptions,
  MatchResult,
  MissingItem,
  OptionalMissingItem,
  Recipe,
  SubstituteOption,
  SubstitutionQuality,
} from './types';

/**
 * 各食材分類在缺料計分中的權重。
 *
 * 基酒最高（缺了整杯要重做），裝飾最低（不影響能不能調出來）。
 */
export const CATEGORY_WEIGHTS: Record<IngredientCategory, number> = {
  'base-spirit': 45,
  'fortified-wine': 30,
  wine: 30,
  liqueur: 25,
  bitter: 15,
  syrup: 15,
  dairy: 12,
  'tea-coffee': 12,
  mixer: 8,
  garnish: 3,
};

/** 未知分類的預設權重，取最低值以免誤判為嚴重缺料。 */
const UNKNOWN_CATEGORY_WEIGHT = 3;

/** 取得某食材分類的權重。 */
export function getCategoryWeight(category: IngredientCategory | string): number {
  return CATEGORY_WEIGHTS[category as IngredientCategory] ?? UNKNOWN_CATEGORY_WEIGHT;
}

/**
 * 將權重四捨五入到小數點後六位，避免浮點運算誤差影響分數比較與顯示。
 */
function roundWeight(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * 依折扣率計算折後權重。
 *
 * 替代品只能減輕缺料成本，不能讓缺料成本歸零，因此折後權重不得低於原權重的 30%。
 *
 * @param baseWeight 原始缺料權重
 * @param rate 折扣率（0 至 1），例如跨類別替代為 0.4
 */
export function applyDiscountRate(baseWeight: number, rate: number): number {
  const retained = Math.max(1 - rate, MIN_RETAINED_WEIGHT_RATIO);
  return roundWeight(baseWeight * retained);
}

/**
 * 依替代品質計算折後權重。
 *
 * 完全同調性（100%）、風味偏移（70%）、跨類別（40%）對應不同的折扣率。
 */
export function applySubstitutionDiscount(
  baseWeight: number,
  quality: SubstitutionQuality | undefined,
): number {
  if (!quality) return baseWeight;
  return applyDiscountRate(baseWeight, SUBSTITUTION_DISCOUNT_RATE[quality]);
}

/**
 * 找出某食材可用的替代品（限使用者手邊已持有的）。
 *
 * 回傳結果依替代品質由好到差排序；品質越好代表替代品越能補足原物料功能。
 */
export function getAvailableSubstitutes(
  ingredientId: string,
  ownedIds: ReadonlySet<string>,
): SubstituteOption[] {
  const rules = getSubstitutionMap().get(ingredientId);
  if (!rules) return [];

  const options: SubstituteOption[] = [];
  for (const rule of rules) {
    for (const target of rule.to) {
      if (!ownedIds.has(target)) continue;
      const quality =
        rule.toQualities.find((entry) => entry.id === target)?.quality ?? rule.quality;
      const ingredient = getIngredient(target);
      options.push({
        id: target,
        zh: ingredient?.zh ?? target,
        quality,
      });
    }
  }

  // 同一個替代品可能出現在多條規則中，先去重再排序。
  const unique = new Map(options.map((option) => [option.id, option]));
  return [...unique.values()].sort(
    (a, b) => SUBSTITUTION_RETAINED_RATIO[a.quality] - SUBSTITUTION_RETAINED_RATIO[b.quality],
  );
}

/**
 * 取得配方需要材料的數量（去重後）。
 *
 * 某些配方的同一項食材同時出現在材料與裝飾（例如莫吉托的薄荷），
 * 計算缺料時不可重複計價，因此以 id 去重。
 */
export function getMaterialCount(recipe: Recipe): number {
  const ids = new Set<string>(recipe.ingredientIds);
  for (const garnishId of recipe.garnishIds) {
    ids.add(garnishId);
  }
  return ids.size;
}

/**
 * 對單杯配方進行比對。
 *
 * includeOptional 為 false 時，選用材料不列入缺料計算，
 * 但缺少的選用材料會另外收在 optionalMissing，
 * 讓介面仍能以較弱的樣式提示「另有選用：冰塊」，而不是把它算成缺料。
 *
 * @param recipe 待比對的配方
 * @param ownedIds 使用者手邊已有的食材 id 集合
 * @param options 比對選項
 */
export function matchRecipe(
  recipe: Recipe,
  ownedIds: ReadonlySet<string>,
  options: MatchOptions = {},
): MatchResult {
  const includeGarnish = options.includeGarnish ?? true;
  const includeOptional = options.includeOptional ?? true;

  const requiredIds = new Set<string>();
  const optionalIds = new Set<string>();
  for (const ingredient of recipe.ingredients) {
    if (ingredient.optional && !includeOptional) {
      optionalIds.add(ingredient.id);
      continue;
    }
    requiredIds.add(ingredient.id);
  }
  if (includeGarnish) {
    for (const garnishId of recipe.garnishIds) {
      // 選用材料即使同時出現在裝飾清單，也不該被當成必要材料
      if (optionalIds.has(garnishId)) continue;
      requiredIds.add(garnishId);
    }
  }

  const missing: MissingItem[] = [];
  let ownedCount = 0;

  for (const id of requiredIds) {
    if (ownedIds.has(id)) {
      ownedCount += 1;
      continue;
    }
    const ingredient = getIngredient(id);
    const category = ingredient?.category ?? 'mixer';
    const baseWeight = getCategoryWeight(category);
    const substitutes = getAvailableSubstitutes(id, ownedIds);

    // 有替代品時，依最佳替代品質給予折扣；折後仍保留部分缺料成本。
    let weight = baseWeight;
    if (substitutes.length > 0) {
      const bestQuality = substitutes[0]?.quality;
      weight = applySubstitutionDiscount(baseWeight, bestQuality);
    }

    missing.push({
      id,
      zh: ingredient?.zh ?? id,
      en: ingredient?.en ?? '',
      weight,
      baseWeight,
      substitutes,
      category,
    });
  }

  missing.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

  // 缺少的選用材料：不計分、不計數，但介面要看得見
  const optionalMissing: OptionalMissingItem[] = [];
  for (const id of optionalIds) {
    if (ownedIds.has(id)) continue;
    const ingredient = getIngredient(id);
    optionalMissing.push({
      id,
      zh: ingredient?.zh ?? id,
      en: ingredient?.en ?? '',
      category: ingredient?.category ?? 'mixer',
    });
  }
  optionalMissing.sort((a, b) => a.id.localeCompare(b.id));

  const score = missing.reduce((sum, item) => sum + item.weight, 0);
  const totalMaterials = requiredIds.size;

  return {
    recipe,
    score,
    missing,
    optionalMissing,
    matchedRatio: totalMaterials === 0 ? 1 : ownedCount / totalMaterials,
    isFullyAvailable: missing.length === 0,
    missingBaseSpirit: missing.some((item) => item.category === 'base-spirit'),
  };
}

/**
 * 比對結果排序規則。
 *
 * 分數低者優先 → 缺料總數少者優先 → 熱門度高者優先 → 材料總數少者優先 → id 字典序（確保排序穩定）。
 */
export function compareMatchResults(a: MatchResult, b: MatchResult): number {
  if (a.score !== b.score) return a.score - b.score;
  if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
  if (a.recipe.popularity !== b.recipe.popularity) {
    return b.recipe.popularity - a.recipe.popularity;
  }
  const aMaterials = getMaterialCount(a.recipe);
  const bMaterials = getMaterialCount(b.recipe);
  if (aMaterials !== bMaterials) return aMaterials - bMaterials;
  return a.recipe.id.localeCompare(b.recipe.id);
}

/**
 * 比對全部配方，回傳依分數排序的結果。
 *
 * @param recipes 待比對的配方清單
 * @param ownedIds 使用者手邊已有的食材 id 集合（也可直接傳入陣列）
 * @param options 比對選項
 */
export function matchRecipes(
  recipes: readonly Recipe[],
  ownedIds: ReadonlySet<string> | readonly string[],
  options: MatchOptions = {},
): MatchResult[] {
  const owned =
    ownedIds instanceof Set ? ownedIds : new Set<string>(ownedIds as readonly string[]);

  const results = recipes.map((recipe) => matchRecipe(recipe, owned, options));

  const maxMissing = options.maxMissing;
  const filtered =
    maxMissing === undefined
      ? results
      : results.filter((result) => result.missing.length <= maxMissing);

  return filtered.sort(compareMatchResults);
}

/**
 * 取分數最低的前 N 杯推薦結果。
 *
 * @param recipes 待比對的配方清單
 * @param ownedIds 使用者手邊已有的食材 id 集合（也可直接傳入陣列）
 * @param limit 取前幾名
 * @param options 比對選項
 */
export function getTopMatches(
  recipes: readonly Recipe[],
  ownedIds: ReadonlySet<string> | readonly string[],
  limit: number,
  options: MatchOptions = {},
): MatchResult[] {
  return matchRecipes(recipes, ownedIds, options).slice(0, Math.max(0, limit));
}
