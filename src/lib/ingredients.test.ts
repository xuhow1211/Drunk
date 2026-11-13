/**
 * 統一食材對照表的單元測試。
 *
 * 對照表是缺料比對引擎的基礎：材料 id 查不到就會被算成缺料，
 * 因此這裡驗證「每個配方的材料 id 都查得到」、「搜尋能找到常見材料」，
 * 以及替代規則的索引方向正確（from → to，而非反向）。
 */
import { describe, expect, it } from 'vitest';
import cocktailData from '../data/cocktails.json';
import catalogJson from '../data/ingredients.json';
import { CATEGORY_LABELS } from './categoryLabels';
import type { CocktailDataset, IngredientCatalog } from './types';
import {
  getByCategory,
  getCategories,
  getCommonIngredients,
  getIngredient,
  getSubstitutionMap,
  searchIngredients,
} from './ingredients';

const catalog = catalogJson as unknown as IngredientCatalog;
const recipes = (cocktailData as unknown as CocktailDataset).recipes;

describe('分類常數（categoryLabels）', () => {
  it('涵蓋對照表中出現的每一個分類，id 與資料一致', () => {
    const labelIds = new Set(CATEGORY_LABELS.map((item) => item.id));
    for (const ingredient of catalog.ingredients) {
      expect(labelIds.has(ingredient.category), ingredient.category).toBe(true);
    }
  });

  it('getCategories 的內容來自常數，且 id 排序與資料無關', () => {
    const categories = getCategories();
    expect(categories.map((item) => item.id)).toEqual(CATEGORY_LABELS.map((item) => item.id));
  });
});

describe('getIngredient', () => {
  it('查得到常見材料', () => {
    const gin = getIngredient('gin');
    expect(gin).toBeDefined();
    expect(gin?.zh).toBe('琴酒（金酒）');
    expect(gin?.common).toBe(true);
  });

  it('查不到時回傳 undefined，不會拋出例外', () => {
    expect(getIngredient('this-ingredient-does-not-exist')).toBeUndefined();
  });

  it('對照表中的每一筆都能以 id 查回', () => {
    for (const ingredient of catalog.ingredients) {
      expect(getIngredient(ingredient.id)?.id).toBe(ingredient.id);
    }
  });
});

describe('getByCategory', () => {
  it('依分類取回的食材都屬於該分類', () => {
    for (const category of getCategories()) {
      for (const ingredient of getByCategory(category.id)) {
        expect(ingredient.category).toBe(category.id);
      }
    }
  });

  it('基酒分類有內容，錯誤分類回傳空陣列', () => {
    expect(getByCategory('base-spirit').length).toBeGreaterThan(0);
    expect(getByCategory('no-such-category')).toEqual([]);
  });
});

describe('getCategories', () => {
  it('依 order 由小到大排序，且每個分類都有中文名稱', () => {
    const categories = getCategories();
    expect(categories.length).toBeGreaterThan(0);

    const orders = categories.map((item) => item.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);

    for (const category of categories) {
      expect(/[一-鿿]/.test(category.zh), category.id).toBe(true);
    }
  });
});

describe('getCommonIngredients', () => {
  it('只回傳標記為常備的食材，且數量少於全部食材', () => {
    const common = getCommonIngredients();
    expect(common.length).toBeGreaterThan(0);
    expect(common.length).toBeLessThan(catalog.ingredients.length);
    for (const ingredient of common) {
      expect(ingredient.common).toBe(true);
    }
  });
});

describe('searchIngredients', () => {
  it('空關鍵字回傳空陣列', () => {
    expect(searchIngredients('')).toEqual([]);
    expect(searchIngredients('   ')).toEqual([]);
  });

  it('可用中文名搜尋', () => {
    const results = searchIngredients('琴酒');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((item) => item.id === 'gin')).toBe(true);
  });

  it('可用英文名與 id 搜尋', () => {
    expect(searchIngredients('gin').some((item) => item.id === 'gin')).toBe(true);
    expect(searchIngredients('campari').length).toBeGreaterThan(0);
  });

  it('命中開頭的結果排在前面', () => {
    const results = searchIngredients('lime');
    expect(results.length).toBeGreaterThan(1);
    expect(results[0]?.zh.startsWith('青檸') || results[0]?.en.toLowerCase().startsWith('lime')).toBe(
      true,
    );
  });

  it('搜尋不到時回傳空陣列', () => {
    expect(searchIngredients('這個食材一定不存在zzz')).toEqual([]);
  });
});

describe('getSubstitutionMap', () => {
  it('索引方向是「被替代的食材 → 可替代它的規則」', () => {
    const map = getSubstitutionMap();
    expect(map.size).toBeGreaterThan(0);

    for (const [from, rules] of map) {
      for (const rule of rules) {
        expect(rule.from).toBe(from);
        expect(rule.to.length).toBeGreaterThan(0);
      }
    }
  });

  it('索引內容與原始規則清單一致', () => {
    const map = getSubstitutionMap();
    const total = [...map.values()].reduce((sum, rules) => sum + rules.length, 0);
    expect(total).toBe(catalog.substitutions.length);
  });

  it('替代目標都是存在的食材', () => {
    for (const rules of getSubstitutionMap().values()) {
      for (const rule of rules) {
        for (const target of rule.to) {
          expect(getIngredient(target), target).toBeDefined();
        }
      }
    }
  });
});

describe('配方材料與對照表的整合', () => {
  it('每個配方的每一項材料 id 都存在於對照表', () => {
    for (const recipe of recipes) {
      for (const id of recipe.ingredientIds) {
        expect(getIngredient(id), `${recipe.id} 的材料 ${id}`).toBeDefined();
      }
      for (const id of recipe.garnishIds) {
        expect(getIngredient(id), `${recipe.id} 的裝飾 ${id}`).toBeDefined();
      }
    }
  });

  it('對照表涵蓋所有配方用到的材料，且每筆食材都有完整的基本資料', () => {
    const used = new Set<string>();
    for (const recipe of recipes) {
      for (const id of recipe.ingredientIds) used.add(id);
      for (const id of recipe.garnishIds) used.add(id);
    }

    // 對照表刻意是配方的超集：多出的食材是給使用者勾選、供日後新增配方使用，
    // 因此這裡只驗證「配方用到的都在對照表內」與「每筆食材資料完整」。
    for (const id of used) {
      expect(getIngredient(id), id).toBeDefined();
    }

    for (const ingredient of catalog.ingredients) {
      expect(ingredient.zh.length, ingredient.id).toBeGreaterThan(0);
      expect(ingredient.en.length, ingredient.id).toBeGreaterThan(0);
      expect(
        Object.keys(catalog.categories).includes(ingredient.category),
        `${ingredient.id} 的分類 ${ingredient.category} 未登錄`,
      ).toBe(true);
    }
  });
});
