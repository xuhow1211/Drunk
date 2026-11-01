/**
 * 缺料嚴重程度分級的單元測試。
 *
 * 嚴重程度決定結果卡上缺料標籤的視覺層級（邊框色與文字色），
 * 分級錯了會讓使用者誤判「這杯差很多」或「只差一點」，
 * 因此每個食材分類都必須落到明確且穩定的級距。
 */
import { describe, expect, it } from 'vitest';
import catalogJson from '../data/ingredients.json';
import type { Ingredient, IngredientCategory } from './types';
import { SEVERITY_CLASSES, SEVERITY_LABELS, severityOf } from './severity';

const catalog = catalogJson as unknown as {
  categories: Record<string, { zh: string; order: number }>;
  ingredients: Ingredient[];
};

/** 合法分類的完整清單，逐一確認分級結果。 */
const EXPECTED: Record<IngredientCategory, 'critical' | 'major' | 'minor' | 'trivial'> = {
  'base-spirit': 'critical',
  'fortified-wine': 'critical',
  wine: 'critical',
  liqueur: 'major',
  syrup: 'minor',
  bitter: 'minor',
  dairy: 'minor',
  'tea-coffee': 'minor',
  mixer: 'trivial',
  garnish: 'trivial',
};

describe('severityOf', () => {
  it('合法分類的分級符合預期', () => {
    for (const [category, expected] of Object.entries(EXPECTED)) {
      expect(severityOf(category as IngredientCategory), category).toBe(expected);
    }
  });

  it('缺基酒與烈酒屬最高級，缺飲料屬最低級', () => {
    expect(severityOf('base-spirit')).toBe('critical');
    expect(severityOf('mixer')).toBe('trivial');
  });

  it('未列出的分類（default 分支）退回最低級，不會讓建置失敗', () => {
    expect(severityOf('unknown-category' as IngredientCategory)).toBe('trivial');
  });

  it('對照表中的每個食材分類都能分級，不會拋出例外', () => {
    for (const category of Object.keys(catalog.categories)) {
      expect(() => severityOf(category as IngredientCategory)).not.toThrow();
    }
  });

  it('真實食材清單中的每一筆都能取得嚴重程度', () => {
    for (const ingredient of catalog.ingredients) {
      const severity = severityOf(ingredient.category);
      expect(SEVERITY_LABELS[severity], ingredient.id).toBeTypeOf('string');
      expect(SEVERITY_CLASSES[severity], ingredient.id).toBeTypeOf('string');
    }
  });
});

describe('嚴重程度對照表', () => {
  it('四個級距都有中文說明與樣式類別', () => {
    expect(Object.keys(SEVERITY_LABELS)).toEqual([
      'critical',
      'major',
      'minor',
      'trivial',
    ]);
    for (const label of Object.values(SEVERITY_LABELS)) {
      expect(/[一-鿿]/.test(label), label).toBe(true);
    }
    for (const className of Object.values(SEVERITY_CLASSES)) {
      expect(className.length).toBeGreaterThan(0);
    }
  });
});
