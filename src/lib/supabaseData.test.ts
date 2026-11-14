/**
 * Supabase 資料對應的單元測試。
 *
 * 驗證 DB（snake_case）→ 前端型別（camelCase）的對應規則，包括：
 * 欄位更名、可空欄位的補空、嵌入材料的對應、替代規則的逐列聚合，
 * 以及分頁讀滿整表的迴圈行為。全部以假 client 模擬，不做真實網路請求。
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSupabaseData } from './supabaseData';

/** 一次 range 查詢的建置紀錄，供驗證查詢語法與分頁。 */
interface BuildRecord {
  /** 表名。 */
  table: string;
  /** select 參數。 */
  select: string;
  /** order 參數（依呼叫順序）。 */
  orders: Array<Record<string, unknown>>;
  /** range 的 from／to。 */
  range: { from: number; to: number };
}

/**
 * 假 client：依表名回傳切片頁，並記錄每次建置的 select／order／range。
 *
 * @param rowsByTable 表名 → 該表的整批資料
 * @param fail true 時所有 range 查詢回傳錯誤
 */
function createFakeClient(rowsByTable: Record<string, unknown[]>, fail = false) {
  const builds: BuildRecord[] = [];
  const client = {
    from: (table: string) => ({
      select: (selectClause: string) => {
        const orders: Array<Record<string, unknown>> = [];
        const chain = {
          order: (column: string, options: Record<string, unknown> = { ascending: true }) => {
            orders.push({ column, ...options });
            return chain;
          },
          range: (from: number, to: number) => {
            builds.push({ table, select: selectClause, orders: [...orders], range: { from, to } });
            return fail
              ? Promise.resolve({ data: null, error: { message: '模擬失敗' } })
              : Promise.resolve({
                  data: (rowsByTable[table] ?? []).slice(from, to + 1),
                  error: null,
                });
          },
        };
        return chain;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, builds };
}

/** 一筆涵蓋各欄位情境的配方列。 */
const recipeRow = {
  id: 'gin-fizz',
  name_en: 'Gin Fizz',
  name_zh: '琴費士',
  aliases: ['金費士'],
  collections: ['classic', 'popular'],
  category: 'fizz',
  glass: 'highball',
  ice: 'shake',
  difficulty: 1,
  abv: null,
  time: null,
  popularity: 3,
  steps: ['搖盪後濾入杯中'],
  garnish_ids: ['lemon-slice'],
  flavor: ['citrus'],
  occasion: ['anytime'],
  tags: ['iba'],
  source_url: 'https://example.com/gin-fizz',
  source_site: 'IBA',
  photo_url: 'https://example.com/photo/gin-fizz.webp',
  recipe_ingredients: [
    { ingredient_id: 'soda-water', amount: null, unit: null, optional: false, position: 2 },
    { ingredient_id: 'gin', amount: '45', unit: 'ml', optional: false, position: 1 },
  ],
};

/** 各可空欄位皆為預設值的配方列（驗證補空用）。 */
const baseRecipeRow = {
  aliases: null,
  collections: null,
  category: 'fizz',
  glass: 'highball',
  ice: 'stir',
  difficulty: 1,
  abv: null,
  time: null,
  popularity: 1,
  steps: ['步驟'],
  garnish_ids: null,
  flavor: null,
  occasion: null,
  tags: null,
  source_url: null,
  source_site: null,
  photo_url: null,
  recipe_ingredients: null,
};

describe('loadSupabaseData 對應規則', () => {
  it('欄位更名、可空補空、材料嵌入與替代規則逐列聚合都正確', async () => {
    const { client } = createFakeClient({
      recipes: [recipeRow],
      ingredients: [
        { id: 'gin', zh: '琴酒（金酒）', en: 'Gin', category: 'base-spirit', common: true, aliases: ['金酒'] },
      ],
      substitutions: [
        { from_id: 'simple-syrup', to_id: 'honey-syrup', quality: 'same', note: '等甜度替代' },
        { from_id: 'simple-syrup', to_id: 'sugar-syrup', quality: 'close', note: null },
        { from_id: 'gin', to_id: 'vodka', quality: 'close', note: '烈酒互換' },
      ],
    });

    const { dataset, catalog } = await loadSupabaseData(client);
    const recipe = dataset.recipes[0];
    expect(recipe).toBeDefined();
    if (!recipe) return;

    // 欄位更名
    expect(recipe.nameEn).toBe('Gin Fizz');
    expect(recipe.nameZh).toBe('琴費士');
    expect(recipe.garnishIds).toEqual(['lemon-slice']);
    expect(recipe.garnish).toEqual(['lemon-slice']);
    expect(recipe.sourceUrl).toBe('https://example.com/gin-fizz');
    expect(recipe.sourceSite).toBe('IBA');
    // 示意照片：photo_url 有值時對應成 photoUrl
    expect(recipe.photoUrl).toBe('https://example.com/photo/gin-fizz.webp');
    expect(recipe.collection).toBe('classic');
    expect(recipe.collections).toEqual(['classic', 'popular']);
    // 可空欄位的補空
    expect(recipe.abv).toBe('');
    expect(recipe.time).toBe('');
    // 材料嵌入：ingredient_id 更名、null 用量保留、ingredientIds 依嵌入順序
    expect(recipe.ingredients).toEqual([
      { id: 'soda-water', amount: null, unit: null, optional: false },
      { id: 'gin', amount: 45, unit: 'ml', optional: false },
    ]);
    expect(recipe.ingredientIds).toEqual(['soda-water', 'gin']);

    // 食材對應
    expect(catalog.ingredients).toEqual([
      { id: 'gin', zh: '琴酒（金酒）', en: 'Gin', category: 'base-spirit', common: true, aliases: ['金酒'] },
    ]);

    // 替代規則：同一 from_id 收成一組，quality 取第一筆、note 取第一筆非空、逐項品質保留
    expect(catalog.substitutions).toEqual([
      {
        from: 'simple-syrup',
        to: ['honey-syrup', 'sugar-syrup'],
        note: '等甜度替代',
        quality: 'same',
        toQualities: [
          { id: 'honey-syrup', quality: 'same' },
          { id: 'sugar-syrup', quality: 'close' },
        ],
      },
      {
        from: 'gin',
        to: ['vodka'],
        note: '烈酒互換',
        quality: 'close',
        toQualities: [{ id: 'vodka', quality: 'close' }],
      },
    ]);
  });

  it('各欄位為 null 時一律補回空值形狀，與建置 JSON 的空缺形狀一致', async () => {
    const { client } = createFakeClient({
      recipes: [{ ...baseRecipeRow, id: 'r2', name_en: 'E2', name_zh: '譯2' }],
      ingredients: [],
      substitutions: [],
    });

    const { dataset } = await loadSupabaseData(client);
    const recipe = dataset.recipes[0];
    expect(recipe).toBeDefined();
    if (!recipe) return;
    expect(recipe.aliases).toEqual([]);
    expect(recipe.collections).toEqual([]);
    expect(recipe.collection).toBe('classic');
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.ingredientIds).toEqual([]);
    expect(recipe.garnish).toEqual([]);
    expect(recipe.sourceSite).toBeUndefined();
    // 示意照片為 null（尚未抓圖）時不設 photoUrl 欄位，與建置 JSON 的形狀一致
    expect('photoUrl' in recipe).toBe(false);
  });

  it('查詢語法包含材料嵌入與排序參數，列數超過 1000 時逐頁抓滿', async () => {
    const pageRows = Array.from({ length: 1001 }, (_, index) => ({
      ...baseRecipeRow,
      id: `r${index}`,
      name_en: `E${index}`,
      name_zh: `譯${index}`,
    }));
    const { client, builds } = createFakeClient({
      recipes: pageRows,
      ingredients: [],
      substitutions: [],
    });

    const { dataset } = await loadSupabaseData(client);
    expect(dataset.recipes).toHaveLength(1001);

    const recipeBuilds = builds.filter((build) => build.table === 'recipes');
    expect(recipeBuilds[0]?.select).toContain('recipe_ingredients');
    expect(recipeBuilds[0]?.orders).toEqual([
      { column: 'popularity', ascending: false },
      { column: 'id', ascending: true },
      { column: 'position', referencedTable: 'recipe_ingredients', ascending: true },
    ]);
    // 1001 列：第一頁 0~999，第二頁 1000~1999（回傳 1 列後停止）
    expect(recipeBuilds.map((build) => [build.range.from, build.range.to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('任一表查詢失敗時拋出例外（呼叫端走降級路徑）', async () => {
    const { client } = createFakeClient(
      { recipes: [], ingredients: [], substitutions: [] },
      true,
    );
    await expect(loadSupabaseData(client)).rejects.toThrow('Supabase 查詢失敗');
  });
});
