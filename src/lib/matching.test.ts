/**
 * 加權缺料比對引擎的單元測試。
 *
 * 全部案例都使用真實資料（src/data/cocktails.json 與 src/data/ingredients.json），
 * 以具名配方（尼格羅尼、瑪格麗特、莫吉托、威士忌酸酒等）搭配指定手邊材料做斷言。
 */
import { describe, expect, it } from 'vitest';
import cocktailData from '../data/cocktails.json';
import type { CocktailDataset, Recipe } from './types';
import {
  applyDiscountRate,
  applySubstitutionDiscount,
  compareMatchResults,
  getTopMatches,
  matchRecipe,
  matchRecipes,
} from './matching';

const dataset = cocktailData as unknown as CocktailDataset;
const recipes = dataset.recipes;

/** 依 id 取得真實配方，測試失敗時可一眼看出是哪一杯。 */
function recipeById(id: string): Recipe {
  const recipe = recipes.find((item) => item.id === id);
  if (!recipe) throw new Error(`測試資料中找不到配方：${id}`);
  return recipe;
}

describe('比對引擎（真實資料）', () => {
  it('零缺料時 isFullyAvailable 為 true 且 score 為 0', () => {
    const negroni = recipeById('negroni');
    const owned = ['gin', 'campari', 'vermouth-red', 'orange-peel'];

    const result = matchRecipe(negroni, new Set(owned));

    expect(result.isFullyAvailable).toBe(true);
    expect(result.score).toBe(0);
    expect(result.missing).toHaveLength(0);
    expect(result.matchedRatio).toBe(1);
  });

  it('加權正確性：缺基酒的分數高於缺飲料的分數', () => {
    const mojito = recipeById('mojito');
    const all = ['rum-white', 'lime-juice', 'mint', 'sugar-syrup', 'soda-water', 'lime-peel'];

    const missingBaseSpirit = matchRecipe(
      mojito,
      new Set(all.filter((id) => id !== 'rum-white')),
    );
    const missingMixer = matchRecipe(
      mojito,
      new Set(all.filter((id) => id !== 'soda-water')),
    );

    // 莫吉托：朗姆（基酒）45 分、蘇打水（飲料）8 分
    expect(missingBaseSpirit.score).toBe(45);
    expect(missingMixer.score).toBe(8);
    expect(missingBaseSpirit.score).toBeGreaterThan(missingMixer.score);
  });

  it('替代品不會消除缺料，但會在 missing 中提供替代建議', () => {
    const whiskeySour = recipeById('whiskey-sour');
    const owned = [
      'whiskey-bourbon',
      'lemon-juice',
      'egg-white',
      'orange-peel',
      'cherry',
      'honey-syrup', // 蜂蜜糖漿可替代 simple-syrup
    ];

    const result = matchRecipe(whiskeySour, new Set(owned));

    // simple-syrup 仍然是缺料
    const missingSyrup = result.missing.find((item) => item.id === 'simple-syrup');
    expect(missingSyrup).toBeDefined();
    expect(result.isFullyAvailable).toBe(false);
    // 威士忌酸（跨來源整併後共 7 項材料）缺苦精、豐富糖漿、糖漿與鹽
    expect(result.missing.map((item) => item.id)).toEqual([
      'angostura-bitters',
      'rich-syrup',
      'simple-syrup',
      'salt',
    ]);

    // 但有替代建議
    expect(missingSyrup?.substitutes).toEqual([
      { id: 'honey-syrup', zh: '蜂蜜糖漿', quality: 'same' },
    ]);
  });

  it('替代折扣生效：同樣缺一樣，有替代品的分數不高於沒有替代品的分數', () => {
    const whiskeySour = recipeById('whiskey-sour');
    const baseOwned = [
      'whiskey-bourbon',
      'lemon-juice',
      'egg-white',
      'orange-peel',
      'cherry',
    ];

    const withoutSubstitute = matchRecipe(whiskeySour, new Set(baseOwned));
    const withSubstitute = matchRecipe(
      whiskeySour,
      new Set([...baseOwned, 'honey-syrup']),
    );

    // 沒有替代品時糖漿照原權重 15 分計算，其餘缺料為苦精 15、豐富糖漿 15、鹽 3
    expect(withoutSubstitute.score).toBe(48);
    expect(
      withoutSubstitute.missing.find((item) => item.id === 'simple-syrup')?.weight,
    ).toBe(15);
    expect(
      withoutSubstitute.missing.find((item) => item.id === 'simple-syrup')?.substitutes,
    ).toHaveLength(0);

    // 有完全同調性的替代品時折後權重為 15 × 0.3 = 4.5，總分降為 37.5
    expect(withSubstitute.score).toBeLessThanOrEqual(withoutSubstitute.score);
    expect(withSubstitute.score).toBe(37.5);
    expect(
      withSubstitute.missing.find((item) => item.id === 'simple-syrup')?.weight,
    ).toBe(4.5);
  });

  it('折扣下限：折後權重不低於原權重的 30%', () => {
    // 完全同調性折扣率 100%，折後受 30% 下限保護
    expect(applyDiscountRate(45, 1)).toBe(13.5);
    expect(applyDiscountRate(45, 0.7)).toBe(13.5);
    expect(applyDiscountRate(45, 0.4)).toBe(27);

    expect(applySubstitutionDiscount(45, 'same')).toBe(13.5);
    expect(applySubstitutionDiscount(25, 'close')).toBe(7.5);
    expect(applySubstitutionDiscount(8, 'cross')).toBe(4.8);

    // 全部真實配方的缺料項目都必須符合下限
    const results = matchRecipes(recipes, ['gin', 'campari', 'orange-juice']);
    for (const result of results) {
      for (const item of result.missing) {
        expect(item.weight).toBeGreaterThanOrEqual(item.baseWeight * 0.3);
      }
    }
  });

  it('同分時依熱門度排序：熱門度高的血瑪莉啤酒排在同分的蘋果西打啤酒之前', () => {
    const owned = new Set(['orange-liqueur', 'lime-juice', 'lime-peel', 'salt']);
    const results = matchRecipes(recipes, owned);

    const bloodyMaryBeer = results.find((item) => item.recipe.id === 'bloody-mary-beer');
    const appleCiderBeer = results.find((item) => item.recipe.id === 'apple-cider-beer');

    // 分數與缺料數相同時只能靠熱門度分出高下
    expect(bloodyMaryBeer?.score).toBe(appleCiderBeer?.score);
    expect(bloodyMaryBeer?.missing.length).toBe(appleCiderBeer?.missing.length);
    expect(bloodyMaryBeer?.recipe.popularity).toBe(4);
    expect(appleCiderBeer?.recipe.popularity).toBe(3);

    const firstIndex = results.findIndex((item) => item.recipe.id === 'bloody-mary-beer');
    const secondIndex = results.findIndex((item) => item.recipe.id === 'apple-cider-beer');
    expect(firstIndex).toBeLessThan(secondIndex);
  });

  it('完全同分時以 id 字典序穩定排序', () => {
    const owned = new Set(['aperol', 'soda-water']);
    const results = matchRecipes(recipes, owned);

    const spritz = results.find((item) => item.recipe.id === 'spritz');
    const aperolSpritz = results.find((item) => item.recipe.id === 'aperol-spritz');

    // 兩杯配方結構與熱門度完全相同，只能靠 id 字典序決定先後
    expect(spritz?.score).toBe(33);
    expect(aperolSpritz?.score).toBe(33);
    expect(spritz?.missing.length).toBe(aperolSpritz?.missing.length);
    expect(spritz?.recipe.popularity).toBe(aperolSpritz?.recipe.popularity);

    const spritzIndex = results.findIndex((item) => item.recipe.id === 'spritz');
    const aperolIndex = results.findIndex((item) => item.recipe.id === 'aperol-spritz');
    expect(aperolIndex).toBeLessThan(spritzIndex);
  });

  it('空材料清單不會崩潰，會回傳全部配方且各配方為全缺分數', () => {
    const results = matchRecipes(recipes, []);

    expect(results).toHaveLength(recipes.length);
    for (const result of results) {
      expect(result.isFullyAvailable).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
      expect(result.score).toBeGreaterThan(0);
      expect(result.matchedRatio).toBe(0);
      expect(Number.isFinite(result.score)).toBe(true);
    }
  });

  it('includeGarnish 為 false 時不計裝飾缺料', () => {
    const negroni = recipeById('negroni');
    const owned = new Set(['gin', 'campari', 'vermouth-red']);

    const withGarnish = matchRecipe(negroni, owned);
    const withoutGarnish = matchRecipe(negroni, owned, { includeGarnish: false });

    // 裝飾橙皮 3 分
    expect(withGarnish.score).toBe(3);
    expect(withGarnish.missing.map((item) => item.id)).toEqual(['orange-peel']);

    expect(withoutGarnish.score).toBe(0);
    expect(withoutGarnish.missing).toHaveLength(0);
    expect(withoutGarnish.isFullyAvailable).toBe(true);
  });

  it('maxMissing 過濾有效，只留下缺料數不超過上限的配方', () => {
    const owned = new Set(['gin', 'campari', 'vermouth-red', 'orange-peel']);
    const results = matchRecipes(recipes, owned, { maxMissing: 0 });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.missing.length).toBe(0);
      expect(result.isFullyAvailable).toBe(true);
    }

    const unfiltered = matchRecipes(recipes, owned);
    expect(unfiltered.length).toBeGreaterThan(results.length);
  });

  it('matchedRatio 計算正確（已備材料數除以材料總數）', () => {
    const negroni = recipeById('negroni');
    const owned = new Set(['gin', 'campari']);

    const result = matchRecipe(negroni, owned);

    // 尼格羅尼共 4 項材料（琴酒、康帕利、甜味美思、橙皮），已備 2 項
    expect(result.matchedRatio).toBeCloseTo(0.5, 10);
    expect(result.missing.map((item) => item.id)).toEqual(['vermouth-red', 'orange-peel']);
    expect(result.score).toBe(33);
  });

  it('missingBaseSpirit 判定正確：缺基酒為 true，缺其他分類為 false', () => {
    const negroni = recipeById('negroni');

    const missingGin = matchRecipe(
      negroni,
      new Set(['campari', 'vermouth-red', 'orange-peel']),
    );
    const missingCampari = matchRecipe(
      negroni,
      new Set(['gin', 'vermouth-red', 'orange-peel']),
    );
    const missingVermouth = matchRecipe(
      negroni,
      new Set(['gin', 'campari', 'orange-peel']),
    );

    expect(missingGin.missingBaseSpirit).toBe(true);
    expect(missingCampari.missingBaseSpirit).toBe(false);
    expect(missingVermouth.missingBaseSpirit).toBe(false);
  });

  it('getTopMatches 取分數最低的前 N 名', () => {
    const owned = new Set(['gin', 'campari', 'vermouth-red']);
    const top = getTopMatches(recipes, owned, 5);

    expect(top).toHaveLength(5);
    const scores = top.map((item) => item.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(top[0]?.score).toBeLessThanOrEqual(top[4]?.score ?? 0);
  });

  it('排序規則：分數、缺料數、熱門度、材料數、id 依序比較', () => {
    const owned = new Set(['gin', 'campari', 'vermouth-red']);
    const results = matchRecipes(recipes, owned);

    for (let index = 1; index < results.length; index += 1) {
      const previous = results[index - 1];
      const current = results[index];
      if (!previous || !current) continue;
      expect(compareMatchResults(previous, current)).toBeLessThanOrEqual(0);
    }
  });
});

describe('選用材料（includeOptional）', () => {
  it('includeOptional 為 false 時，選用材料不計入缺料但會出現在 optionalMissing', () => {
    const afterglow = recipeById('afterglow');
    const owned = new Set(['grenadine', 'orange-juice', 'pineapple-juice', 'orange-peel']);

    const result = matchRecipe(afterglow, owned, { includeOptional: false });

    // 冰塊是選用材料，不列入缺料
    expect(result.missing.map((item) => item.id)).not.toContain('ice');
    expect(result.missing).toHaveLength(0);
    expect(result.score).toBe(0);
    expect(result.isFullyAvailable).toBe(true);

    // 但仍要讓介面知道有選用材料缺少
    expect(result.optionalMissing.map((item) => item.id)).toEqual(['ice']);
    expect(result.optionalMissing[0]?.zh).toBe('冰塊');
  });

  it('includeOptional 為 false 時，選用材料已擁有就不會出現在 optionalMissing', () => {
    const afterglow = recipeById('afterglow');
    const owned = new Set([
      'grenadine',
      'orange-juice',
      'pineapple-juice',
      'orange-peel',
      'ice',
    ]);

    const result = matchRecipe(afterglow, owned, { includeOptional: false });

    expect(result.optionalMissing).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it('includeOptional 為 true（預設）時，選用材料照舊計入缺料且 optionalMissing 為空', () => {
    const afterglow = recipeById('afterglow');
    const owned = new Set(['grenadine', 'orange-juice', 'pineapple-juice', 'orange-peel']);

    const result = matchRecipe(afterglow, owned);

    expect(result.missing.map((item) => item.id)).toContain('ice');
    expect(result.optionalMissing).toHaveLength(0);
    expect(result.score).toBeGreaterThan(0);
    expect(result.isFullyAvailable).toBe(false);
  });

  it('includeOptional 為 false 時，裝飾不列入缺料（與比對模式的設定一致）', () => {
    const afterglow = recipeById('afterglow');
    const owned = new Set(['grenadine', 'orange-juice', 'pineapple-juice']);

    const result = matchRecipe(afterglow, owned, {
      includeOptional: false,
      includeGarnish: false,
    });

    expect(result.missing).toHaveLength(0);
    expect(result.optionalMissing.map((item) => item.id)).toEqual(['ice']);
  });

  it('含選用材料的配方在關閉選用計分後，缺料數明顯下降', () => {
    const whiskeySour = recipeById('whiskey-sour');
    const owned = new Set([
      'whiskey-bourbon',
      'lemon-juice',
      'simple-syrup',
      'rich-syrup',
      'angostura-bitters',
      'salt',
      'orange-peel',
      'cherry',
    ]);

    const withOptional = matchRecipe(whiskeySour, owned);
    const withoutOptional = matchRecipe(whiskeySour, owned, { includeOptional: false });

    // 蛋白是選用材料
    expect(withOptional.missing.map((item) => item.id)).toContain('egg-white');
    expect(withoutOptional.missing.map((item) => item.id)).not.toContain('egg-white');
    expect(withoutOptional.optionalMissing.map((item) => item.id)).toEqual(['egg-white']);
    expect(withoutOptional.score).toBeLessThan(withOptional.score);
  });

  it('真實資料中每一杯的選用材料在關閉選用計分後都不會出現在缺料清單', () => {
    const owned = new Set(['gin', 'campari', 'orange-juice']);
    const results = matchRecipes(recipes, owned, { includeOptional: false });

    let optionalCount = 0;
    for (const result of results) {
      const optionalIds = new Set(
        result.recipe.ingredients
          .filter((ingredient) => ingredient.optional)
          .map((ingredient) => ingredient.id),
      );
      optionalCount += optionalIds.size;

      for (const item of result.missing) {
        expect(
          optionalIds.has(item.id),
          `${result.recipe.id} 的 ${item.id} 是選用材料，不應列入缺料`,
        ).toBe(false);
      }
    }
    expect(optionalCount).toBeGreaterThan(0);
  });
});
