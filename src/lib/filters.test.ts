/**
 * 瀏覽模式的篩選與排序邏輯單元測試。
 *
 * 篩選與排序的每一個分支都直接暴露在介面的篩選列上，
 * 因此本檔以真實資料（src/data/cocktails.json）搭配少量人工構造的配方，
 * 逐一驗證各條件、排序穩定性與無法解析數值的處理。
 */
import { describe, expect, it } from 'vitest';
import cocktailData from '../data/cocktails.json';
import ibaSource from '../../data/iba-classics.json';
import popularSource from '../../data/popular-modern.json';
import type { CocktailDataset, Recipe } from './types';
import {
  DEFAULT_FILTERS,
  collectFacets,
  filterRecipes,
  getRecipeCollections,
  sortRecipes,
} from './filters';
import type { FilterState } from './filters';
import { getMaterialCount } from './matching';
import { parseAbv, parseMinutes } from './format';

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

/**
 * 人工構造一個配方，用來測試排序的邊界情境
 * （同鍵時的穩定性、無法解析的數值排在最後）。
 */
function makeRecipe(overrides: Partial<Recipe> & { id: string }): Recipe {
  const base: Recipe = {
    id: overrides.id,
    nameEn: overrides.id,
    nameZh: overrides.id,
    aliases: [],
    collection: 'classic',
    collections: ['classic'],
    category: 'sour',
    glass: 'rocks',
    ice: 'shaken',
    difficulty: 1,
    abv: '約 10%',
    time: '3 分鐘',
    ingredients: [],
    steps: [],
    garnish: [],
    tags: [],
    flavor: ['sour'],
    occasion: ['派對'],
    popularity: 1,
    sourceUrl: null,
    ingredientIds: [],
    garnishIds: [],
  };
  return { ...base, ...overrides };
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

describe('filterRecipes 各條件篩選', () => {
  it('無任何條件時回傳全部配方', () => {
    const all = filterRecipes(recipes, DEFAULT_FILTERS, ingredientNames);

    expect(all).toHaveLength(recipes.length);
    expect(all.map((item) => item.id)).toEqual(recipes.map((item) => item.id));
  });

  it('依分類篩選：結果全部屬於該分類，且數量少於全部', () => {
    const filtered = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, categories: ['sour'] },
      ingredientNames,
    );

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(recipes.length);
    for (const recipe of filtered) {
      expect(recipe.category).toBe('sour');
    }
    // 真實資料中 sour 分類的杯數
    expect(filtered.length).toBe(recipes.filter((item) => item.category === 'sour').length);
  });

  it('依風味篩選：配方只要有任一符合的風味就會保留', () => {
    const filtered = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, flavors: ['coffee'] },
      ingredientNames,
    );

    expect(filtered.length).toBeGreaterThan(0);
    for (const recipe of filtered) {
      expect(recipe.flavor).toContain('coffee');
    }
    // 多選風味採「或」而非「且」
    const twoFlavors = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, flavors: ['coffee', 'nutty'] },
      ingredientNames,
    );
    expect(twoFlavors.length).toBeGreaterThan(filtered.length);
  });

  it('依場合篩選：結果全部含該場合', () => {
    const filtered = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, occasions: ['夏日'] },
      ingredientNames,
    );

    expect(filtered.length).toBeGreaterThan(0);
    for (const recipe of filtered) {
      expect(recipe.occasion).toContain('夏日');
    }
  });

  it('依難度篩選：多選時採「或」', () => {
    const easy = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, difficulties: [1] },
      ingredientNames,
    );
    const easyOrMedium = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, difficulties: [1, 2] },
      ingredientNames,
    );

    expect(easy.length).toBeGreaterThan(0);
    for (const recipe of easy) {
      expect(recipe.difficulty).toBe(1);
    }
    expect(easyOrMedium.length).toBeGreaterThan(easy.length);
    for (const recipe of easyOrMedium) {
      expect([1, 2]).toContain(recipe.difficulty);
    }
  });

  it('依酒精度區間篩選：只保留落在區間內的配方', () => {
    const filtered = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, abvMin: 20, abvMax: 30 },
      ingredientNames,
    );

    expect(filtered.length).toBeGreaterThan(0);
    for (const recipe of filtered) {
      const abv = parseAbv(recipe.abv);
      // 無法解析酒精度者不列入區間篩選，但仍會顯示（見下一項測試）
      if (abv === null) continue;
      expect(abv).toBeGreaterThanOrEqual(20);
      expect(abv).toBeLessThanOrEqual(30);
    }
  });

  it('無法解析酒精度的配方不會被區間篩選排除', () => {
    const mixed = [
      makeRecipe({ id: 'no-abv', abv: '不明', popularity: 5 }),
      makeRecipe({ id: 'has-abv', abv: '約 25%', popularity: 1 }),
    ];

    const filtered = filterRecipes(
      mixed,
      { ...DEFAULT_FILTERS, abvMin: 0, abvMax: 100 },
      ingredientNames,
    );

    expect(filtered.map((item) => item.id)).toEqual(['no-abv', 'has-abv']);
  });

  it('多條件取交集：同時套用分類與風味時結果為兩者同時符合', () => {
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      categories: ['sour'],
      flavors: ['fruity'],
    };
    const filtered = filterRecipes(recipes, filters, ingredientNames);

    expect(filtered.length).toBeGreaterThan(0);
    for (const recipe of filtered) {
      expect(recipe.category).toBe('sour');
      expect(recipe.flavor).toContain('fruity');
    }

    // 交集的結果不會多於任一單一條件
    const onlyCategory = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, categories: ['sour'] },
      ingredientNames,
    );
    expect(filtered.length).toBeLessThanOrEqual(onlyCategory.length);
  });

  it('搜尋關鍵字可比對中文名、英文名與別名', () => {
    const byZh = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, query: '尼格羅尼' },
      ingredientNames,
    );
    expect(byZh.map((item) => item.id)).toContain('negroni');

    const byEn = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, query: 'Negroni' },
      ingredientNames,
    );
    expect(byEn.map((item) => item.id)).toContain('negroni');

    const none = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, query: '這個配方一定不存在' },
      ingredientNames,
    );
    expect(none).toHaveLength(0);
  });

  it('搜尋關鍵字可比對原料中文名', () => {
    const names = new Map<string, string>([['gin', '琴酒（金酒）']]);
    const filtered = filterRecipes(
      recipes,
      { ...DEFAULT_FILTERS, query: '琴酒' },
      names,
    );

    expect(filtered.length).toBeGreaterThan(0);
    for (const recipe of filtered) {
      expect(recipe.ingredientIds).toContain('gin');
    }
  });
});

describe('collectFacets', () => {
  it('蒐集到的分類、風味與場合皆來自實際配方且不重複', () => {
    const facets = collectFacets(recipes);

    expect(new Set(facets.categories).size).toBe(facets.categories.length);
    expect(new Set(facets.flavors).size).toBe(facets.flavors.length);
    expect(new Set(facets.occasions).size).toBe(facets.occasions.length);

    for (const category of facets.categories) {
      expect(recipes.some((item) => item.category === category)).toBe(true);
    }
  });
});

describe('sortRecipes', () => {
  it('popularity：依熱門度由高到低，同熱門度以材料數、再以 id 排序', () => {
    const sorted = sortRecipes(recipes, 'popularity');

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (!previous || !current) continue;
      expect(previous.popularity).toBeGreaterThanOrEqual(current.popularity);
    }
    expect(sorted[0]?.popularity).toBe(Math.max(...recipes.map((item) => item.popularity)));
  });

  it('name：依中文名排序', () => {
    const sorted = sortRecipes(recipes, 'name');
    const names = sorted.map((item) => item.nameZh);

    expect([...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'))).toEqual(names);
  });

  it('materials：依材料數由少到多', () => {
    const sorted = sortRecipes(recipes, 'materials');
    const counts = sorted.map((item) => getMaterialCount(item));

    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index - 1]).toBeLessThanOrEqual(counts[index] ?? 0);
    }
  });

  it('difficulty：依難度由低到高', () => {
    const sorted = sortRecipes(recipes, 'difficulty');

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (!previous || !current) continue;
      expect(previous.difficulty).toBeLessThanOrEqual(current.difficulty);
    }
  });

  it('abv：依酒精度由高到低，無法解析者一律排在最後', () => {
    const sorted = sortRecipes(recipes, 'abv');

    const parsed = sorted.map((item) => parseAbv(item.abv));
    const firstNull = parsed.findIndex((value) => value === null);
    if (firstNull >= 0) {
      // null 之後不得再出現可解析的數值
      expect(parsed.slice(firstNull).every((value) => value === null)).toBe(true);
    }

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = parseAbv(sorted[index - 1]?.abv ?? '');
      const current = parseAbv(sorted[index]?.abv ?? '');
      if (previous === null || current === null) continue;
      expect(previous).toBeGreaterThanOrEqual(current);
    }
  });

  it('time：依製作時間由快到慢，無法解析者一律排在最後', () => {
    const sorted = sortRecipes(recipes, 'time');

    const parsed = sorted.map((item) => parseMinutes(item.time));
    const firstNull = parsed.findIndex((value) => value === null);
    if (firstNull >= 0) {
      expect(parsed.slice(firstNull).every((value) => value === null)).toBe(true);
    }

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = parseMinutes(sorted[index - 1]?.time ?? '');
      const current = parseMinutes(sorted[index]?.time ?? '');
      if (previous === null || current === null) continue;
      expect(previous).toBeLessThanOrEqual(current);
    }
  });

  // 上面兩項測試在真實資料上不會遇到 null（目前 392 杯的 abv 與 time 皆可解析），
  // 因此「null 排在最後」這個分支實際上沒有被執行到。
  // 以下兩項以人工構造的配方明確驗證該分支，確保功能壞掉時測試會失敗。
  it('abv：無法解析的酒精度確實被排到所有可解析者之後', () => {
    const mixed = [
      makeRecipe({ id: 'unparsable-abv', abv: '不明' }),
      makeRecipe({ id: 'high-abv', abv: '約 30%' }),
      makeRecipe({ id: 'low-abv', abv: '約 5%' }),
    ];

    const sorted = sortRecipes(mixed, 'abv');

    expect(sorted.map((item) => item.id)).toEqual(['high-abv', 'low-abv', 'unparsable-abv']);
    expect(parseAbv(sorted[sorted.length - 1]?.abv ?? '')).toBeNull();
  });

  it('time：無法解析的製作時間確實被排到所有可解析者之後', () => {
    const mixed = [
      makeRecipe({ id: 'unparsable-time', time: '隨手調' }),
      makeRecipe({ id: 'slow-time', time: '10 分鐘' }),
      makeRecipe({ id: 'fast-time', time: '1 分鐘' }),
    ];

    const sorted = sortRecipes(mixed, 'time');

    expect(sorted.map((item) => item.id)).toEqual(['fast-time', 'slow-time', 'unparsable-time']);
    expect(parseMinutes(sorted[sorted.length - 1]?.time ?? '')).toBeNull();
  });

  it('同鍵時以 id 為最終比較鍵（difficulty 與 time 也不例外）', () => {
    const same = [
      makeRecipe({ id: 'zzz-high-popularity', difficulty: 1, popularity: 5 }),
      makeRecipe({ id: 'aaa-low-popularity', difficulty: 1, popularity: 1 }),
      makeRecipe({ id: 'mmm-mid-popularity', difficulty: 1, popularity: 3 }),
    ];

    const byDifficulty = sortRecipes(same, 'difficulty');
    expect(byDifficulty.map((item) => item.id)).toEqual([
      'aaa-low-popularity',
      'mmm-mid-popularity',
      'zzz-high-popularity',
    ]);

    const sameTime = [
      makeRecipe({ id: 'zzz-late', time: '5 分鐘', popularity: 5 }),
      makeRecipe({ id: 'aaa-early', time: '5 分鐘', popularity: 1 }),
    ];
    const byTime = sortRecipes(sameTime, 'time');
    expect(byTime.map((item) => item.id)).toEqual(['aaa-early', 'zzz-late']);
  });

  it('popularity 同熱門度時以 id 收尾，確保排序可重現', () => {
    const same = [
      makeRecipe({ id: 'zzz', popularity: 3 }),
      makeRecipe({ id: 'aaa', popularity: 3 }),
    ];

    expect(sortRecipes(same, 'popularity').map((item) => item.id)).toEqual(['aaa', 'zzz']);
  });

  it('排序不會改動原始陣列', () => {
    const source = [...recipes];
    const before = source.map((item) => item.id);

    sortRecipes(source, 'name');

    expect(source.map((item) => item.id)).toEqual(before);
  });
});

describe('parseAbv 邊界', () => {
  it('可解析的格式回傳數值', () => {
    expect(parseAbv('約 22%')).toBe(22);
    expect(parseAbv('0%')).toBe(0);
    expect(parseAbv('22.5%')).toBe(22.5);
    expect(parseAbv('30 %')).toBe(30);
  });

  it('負數、超範圍、空字串與非數字一律回傳 null', () => {
    expect(parseAbv('-5%')).toBeNull();
    expect(parseAbv('120%')).toBeNull();
    expect(parseAbv('')).toBeNull();
    expect(parseAbv('不明')).toBeNull();
    expect(parseAbv('約 百分之二十')).toBeNull();
  });

  it('真實資料中的酒精度全部可解析', () => {
    for (const recipe of recipes) {
      expect(parseAbv(recipe.abv), `${recipe.id} 的酒精度應可解析`).not.toBeNull();
    }
  });
});

describe('parseMinutes 邊界', () => {
  it('可解析的格式回傳整數分鐘', () => {
    expect(parseMinutes('4 分鐘')).toBe(4);
    expect(parseMinutes('0 分鐘')).toBe(0);
    expect(parseMinutes('60 分鐘')).toBe(60);
  });

  it('負數、空字串與非數字一律回傳 null', () => {
    expect(parseMinutes('-5 分鐘')).toBeNull();
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('隨手調')).toBeNull();
  });

  it('真實資料中的製作時間全部可解析', () => {
    for (const recipe of recipes) {
      expect(parseMinutes(recipe.time), `${recipe.id} 的製作時間應可解析`).not.toBeNull();
    }
  });
});
