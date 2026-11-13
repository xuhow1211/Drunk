/**
 * Supabase 資料讀取與型別對應。
 *
 * 從 Supabase（PostgREST）抓取 recipes／ingredients／substitutions 三張表，
 * 以分頁抓滿整表（Supabase 預設單頁上限 1000 列），再對應成
 * 前端既有的 CocktailDataset／IngredientCatalog 形狀，讓比對引擎與
 * 介面在 Supabase 模式與靜態 JSON 模式共用同一組程式。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoadedData } from './dataLoader';
import type {
  CocktailDataset,
  Ingredient,
  IngredientCatalog,
  Recipe,
  RecipeCategory,
  GlassType,
  Collection,
  Substitution,
  SubstitutionQuality,
} from './types';

/** 每頁列數（Supabase 對 REST 查詢的單頁預設上限為 1000 列）。 */
const PAGE_SIZE = 1000;

/** Supabase recipes 表的單列（含材料嵌入）。 */
interface SupabaseRecipeRow {
  id: string;
  name_en: string;
  name_zh: string;
  aliases: string[] | null;
  collections: string[] | null;
  category: string;
  glass: string;
  ice: string;
  difficulty: number;
  abv: string | null;
  time: string | null;
  popularity: number;
  steps: string[] | null;
  garnish_ids: string[] | null;
  flavor: string[] | null;
  occasion: string[] | null;
  tags: string[] | null;
  source_url: string | null;
  source_site: string | null;
  recipe_ingredients?: SupabaseRecipeIngredientRow[] | null;
}

/** Supabase recipe_ingredients 的嵌入列。 */
interface SupabaseRecipeIngredientRow {
  ingredient_id: string;
  amount: number | string | null;
  unit: string | null;
  optional: boolean;
  position: number;
}

/** Supabase ingredients 表的單列。 */
interface SupabaseIngredientRow {
  id: string;
  zh: string;
  en: string;
  category: string;
  common: boolean;
  aliases: string[] | null;
}

/** Supabase substitutions 表的單列。 */
interface SupabaseSubstitutionRow {
  from_id: string;
  to_id: string;
  quality: string;
  note: string | null;
}

/** supabase-js 的單頁查詢結果（僅取用到的欄位）。 */
interface PostgrestPage<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * 以分頁讀滿整張表。
 *
 * Supabase 的 REST 查詢單頁最多回傳 1000 列，須以 range 反覆抓取，
 * 直到回傳列數少於一頁為止。
 */
async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PostgrestPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const page = await fetchPage(from, from + PAGE_SIZE - 1);
    if (page.error) throw new Error(`Supabase 查詢失敗：${page.error.message}`);
    const data = page.data ?? [];
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
    from += PAGE_SIZE;
  }
}

/** 可空的陣列欄位；一律補回空陣列，保持與建置 JSON 相同的前端形狀。 */
function toList(value: string[] | null | undefined): string[] {
  return value ?? [];
}

/** 對應嵌入的材料列；amount 與 unit 為 null 時沿用既有資料的空缺形狀。 */
function mapRecipeIngredient(row: SupabaseRecipeIngredientRow): Recipe['ingredients'][number] {
  return {
    id: row.ingredient_id,
    amount: row.amount === null ? null : Number(row.amount),
    unit: row.unit,
    optional: row.optional,
  };
}

/** 對應單一配方列。 */
function mapRecipe(row: SupabaseRecipeRow): Recipe {
  const ingredients = (row.recipe_ingredients ?? []).map(mapRecipeIngredient);
  const garnishIds = toList(row.garnish_ids);
  const collections = toList(row.collections) as Collection[];
  const category = row.category as RecipeCategory;
  const glass = row.glass as GlassType;

  return {
    id: row.id,
    nameEn: row.name_en,
    nameZh: row.name_zh,
    aliases: toList(row.aliases),
    // collection 是 collections[0] 的相容欄位（見 types.ts 說明）
    collection: collections[0] ?? 'classic',
    collections,
    category,
    glass,
    ice: row.ice,
    difficulty: row.difficulty,
    abv: row.abv ?? '',
    time: row.time ?? '',
    ingredients,
    steps: toList(row.steps),
    garnish: garnishIds,
    tags: toList(row.tags),
    flavor: toList(row.flavor),
    occasion: toList(row.occasion),
    popularity: row.popularity,
    sourceUrl: row.source_url,
    sourceSite: row.source_site ?? undefined,
    ingredientIds: ingredients.map((item) => item.id),
    garnishIds,
  };
}

/** 對應單一食材列。 */
function mapIngredient(row: SupabaseIngredientRow): Ingredient {
  return {
    id: row.id,
    zh: row.zh,
    en: row.en,
    category: row.category as Ingredient['category'],
    common: row.common,
    aliases: toList(row.aliases),
  };
}

/**
 * 把逐列的替代規則整併為「from → 一組 to」的前端形狀。
 *
 * 資料庫以 (from_id, to_id) 一列一項儲存品質，前端為一組清單，
 * 因此逐列聚合成清單；note 取該組第一筆非空值。
 * quality 在 DB 已受 check 條件約束，此處僅做型別收斂。
 */
function mapSubstitutions(rows: SupabaseSubstitutionRow[]): Substitution[] {
  const grouped = new Map<string, SupabaseSubstitutionRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.from_id);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.from_id, [row]);
    }
  }

  return [...grouped.entries()].map(([from, entries]) => {
    const first = entries[0];
    const quality = first ? (first.quality as SubstitutionQuality) : 'same';
    return {
      from,
      to: entries.map((entry) => entry.to_id),
      note: entries.find((entry) => entry.note)?.note ?? '可替代使用',
      quality,
      toQualities: entries.map((entry) => ({
        id: entry.to_id,
        quality: entry.quality as SubstitutionQuality,
      })),
    };
  });
}

/**
 * 從 Supabase 載入三張表並對應成前端形狀。
 *
 * 配方欄位值在建管期間已白名單收斂（collections／category／glass），
 * 本函式僅做欄位更名與 nullable 補空，不驗證值域（與靜態 JSON 一致）。
 *
 * @param client Supabase 用戶端（由 getSupabaseClient 提供）
 * @returns 配方資料集與食材對照表（categories 由 categoryLabels 常數提供，故為空記錄）
 */
export async function loadSupabaseData(client: SupabaseClient): Promise<LoadedData> {
  const recipeRows = await fetchAll<SupabaseRecipeRow>((from, to) =>
    client
      .from('recipes')
      .select('*,recipe_ingredients(ingredient_id,amount,unit,optional,position)')
      .order('popularity', { ascending: false })
      // 分頁需要全域穩定的排序：popularity 同值者多，補 id 作為唯一次要鍵，
      // 否則跨頁可能漏列出現重複。
      .order('id', { ascending: true })
      .order('position', { referencedTable: 'recipe_ingredients', ascending: true })
      .range(from, to),
  );
  const ingredientRows = await fetchAll<SupabaseIngredientRow>(
    (from, to) =>
      client.from('ingredients').select('*').order('id', { ascending: true }).range(from, to),
  );
  const substitutionRows = await fetchAll<SupabaseSubstitutionRow>(
    // 分頁須有穩定排序，以 (from_id, to_id) 排序避免跨頁漏行列舉重複
    (from, to) =>
      client
        .from('substitutions')
        .select('*')
        .order('from_id', { ascending: true })
        .order('to_id', { ascending: true })
        .range(from, to),
  );

  const dataset: CocktailDataset = {
    version: 'supabase',
    generatedAt: new Date().toISOString(),
    recipes: recipeRows.map(mapRecipe),
  };
  const catalog: IngredientCatalog = {
    version: 'supabase',
    categories: {},
    ingredients: ingredientRows.map(mapIngredient),
    substitutions: mapSubstitutions(substitutionRows),
  };

  return { dataset, catalog };
}
