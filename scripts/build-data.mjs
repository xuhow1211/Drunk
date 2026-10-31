#!/usr/bin/env node
/**
 * join 這麼喝：資料管線建置腳本
 *
 * 讀取 data/ 下的原始爬取檔，統整成前端使用的兩份 JSON：
 *   - src/data/ingredients.json：統一食材對照表
 *   - src/data/cocktails.json：全部配方（含比對引擎所需的 id 清單）
 *
 * 僅使用 Node 內建的 fs / path，不引入任何第三方套件。
 * 驗證關卡若不通過會印出錯誤並以非零碼結束。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const OUT_DIR = path.join(ROOT_DIR, 'src', 'data');

/**
 * 配方來源，順序即優先序：同一個配方 id 出現於多個來源時，保留優先序較前者的版本。
 * 理由：iba-classics 為官方清單，其 collection 分類（classic / new-era）最具權威性。
 */
const SOURCES = [
  { file: 'iba-classics.json', label: 'IBA 官方經典', required: true, defaultCollection: 'classic' },
  { file: 'popular-modern.json', label: '網路熱門推薦', required: true, defaultCollection: 'popular' },
  { file: 'easy-and-local.json', label: '免調酒與台灣在地', required: false, defaultCollection: 'easy' },
];

/** 正規化後合法的配方系列。 */
const ALLOWED_COLLECTIONS = [
  'classic',
  'new-era',
  'popular',
  'mocktail',
  'shot',
  'easy',
  'taiwan',
  'seasonal',
];

/** 來源 collection 值到合法 collection 的對應表。 */
const COLLECTION_ALIASES = {
  classic: 'classic',
  'contemporary-classic': 'classic',
  'iba-classic': 'classic',
  unforgettable: 'classic',
  'new-era': 'new-era',
  newera: 'new-era',
  'new-era-drinks': 'new-era',
  modern: 'new-era',
  popular: 'popular',
  trending: 'popular',
  mocktail: 'mocktail',
  'non-alcoholic': 'mocktail',
  shot: 'shot',
  shots: 'shot',
  easy: 'easy',
  simple: 'easy',
  'easy-and-local': 'easy',
  taiwan: 'taiwan',
  'taiwan-local': 'taiwan',
  seasonal: 'seasonal',
  'seasonal-limited': 'seasonal',
};

/**
 * 替代品質的人工判定表（key 為 `from|to`）。
 *
 * 既有 13 組替代關係的 note 語意已人工確認，逐條列出以避免自動推導誤判。
 * 未列出的關係會走下方的一般推導規則。
 */
const SUBSTITUTION_QUALITY_OVERRIDES = {
  // 等甜度糖漿，視為完全同調
  'simple-syrup|honey-syrup': 'same',
  'simple-syrup|sugar-syrup': 'same',
  // 紅石榴糖漿只能代部分糖漿，風味偏移
  'simple-syrup|grenadine': 'close',
  // 氣泡水家族風味略有差異
  'soda-water|tonic-water': 'close',
  'soda-water|ginger-ale': 'close',
  'soda-water|lemon-lime-soda': 'close',
  // 苦精同類可互換
  'angostura-bitters|orange-bitters': 'same',
  'angostura-bitters|peychaud-bitters': 'same',
  // 柑橘汁同類可互換
  'lemon-juice|lime-juice': 'same',
  'orange-liqueur|curacao': 'same',
  'orange-liqueur|blue-curacao': 'same',
  // 甜味美思同類可互換
  'vermouth-red|vermouth-rose': 'same',
  // 威士忌種類之間屬同調性替換
  'whiskey-bourbon|whiskey-rye': 'same',
  'whiskey-bourbon|whiskey-scotch': 'same',
  'whiskey-bourbon|whiskey-japanese': 'same',
  // 烈酒互換會明顯改變風味
  'gin|vodka': 'close',
  'tequila-blanco|mezcal': 'close',
  'vodka|gin': 'close',
  'vodka|rum-white': 'close',
  'vodka|tequila-blanco': 'close',
  'rum-white|vodka': 'close',
  'rum-white|rum-dark': 'close',
  // 果汁風味明顯不同
  'orange-juice|pineapple-juice': 'close',
  'orange-juice|grapefruit-juice': 'close',
};

/**
 * 人工補充的跨類別替代關係（既有來源僅有同類別替代，缺少跨類別的實務取代方案）。
 * 每一筆都只使用統一對照表中確實存在的食材 id。
 */
const EXTRA_SUBSTITUTIONS = [
  {
    from: 'orange-liqueur',
    to: ['orange-juice'],
    note: '以現榨柳橙汁取代柑橘利口酒（跨類別，風味較樸素）',
    quality: 'cross',
  },
  {
    from: 'sparkling-wine',
    to: ['soda-water'],
    note: '以氣泡水取代氣泡酒（跨類別，氣泡感較弱）',
    quality: 'cross',
  },
  {
    from: 'sake',
    to: ['rice-wine'],
    note: '以米酒取代清酒（跨類別，風味較濃）',
    quality: 'cross',
  },
  {
    from: 'sake-jp',
    to: ['rice-wine'],
    note: '以米酒取代清酒（跨類別，風味較濃）',
    quality: 'cross',
  },
];

/** 記錄建置過程中的各項統計與警告。 */
const stats = {
  ingredientsAdded: 0,
  ingredientsMerged: 0,
  ingredientConflicts: [],
  recipesTotal: 0,
  duplicateRecipes: [],
  collectionCounts: {},
  substitutedRelations: 0,
  inferredRelations: 0,
  unknownCollectionValues: [],
  warnings: [],
};

/** 讀取 JSON 檔案；檔案不存在且非必要來源時回傳 null。 */
function readJson(filePath, { required }) {
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new Error(`缺少必要的資料檔：${path.relative(ROOT_DIR, filePath)}`);
    }
    stats.warnings.push(`略過不存在的來源檔：${path.relative(ROOT_DIR, filePath)}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`解析 JSON 失敗：${path.relative(ROOT_DIR, filePath)}（${error.message}）`);
  }
}

/** 去除前後空白並過濾空字串。 */
function cleanString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/** 依字串排序去重。 */
function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = cleanString(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

/**
 * 正規化單一食材紀錄。
 *
 * 欄位差異處理：別名可能缺漏或重複，一律去重；zh / en 可能為空字串，統一補上。
 */
function normalizeIngredient(raw) {
  return {
    id: cleanString(raw.id),
    zh: cleanString(raw.zh),
    en: cleanString(raw.en),
    category: cleanString(raw.category),
    common: raw.common === true,
    aliases: dedupeStrings(Array.isArray(raw.aliases) ? raw.aliases : []),
  };
}

/**
 * 合併兩筆同 id 的食材。
 *
 * 規則：優先保留 common 為 true 的版本；同樣狀態時以 zh 非空者優先；
 * aliases 一律合併去重；另一方的非空欄位可補上。
 */
function mergeIngredient(existing, incoming) {
  const aliases = dedupeStrings([...(existing.aliases ?? []), ...(incoming.aliases ?? [])]);
  let winner = existing;
  if (incoming.common === true && existing.common !== true) {
    winner = incoming;
  } else if (existing.common === true && incoming.common !== true) {
    winner = existing;
  } else if (!cleanString(existing.zh) && cleanString(incoming.zh)) {
    winner = incoming;
  }
  const merged = { ...winner, aliases };
  if (!cleanString(merged.zh) && cleanString(existing.zh)) merged.zh = existing.zh;
  if (!cleanString(merged.en) && cleanString(existing.en)) merged.en = existing.en;
  if (!cleanString(merged.category) && cleanString(existing.category)) {
    merged.category = existing.category;
  }
  return merged;
}

/**
 * 推導替代關係的品質。
 *
 * 一般推導規則（未列入人工判定表者適用）：
 *   1. note 提到明顯折衷或損失（失去、略異、部分、不同）→ close
 *   2. from 與 to 分類不同 → cross
 *   3. 其餘視為同調性 → same
 */
function inferSubstitutionQuality(from, to, note, categoryOf) {
  const override = SUBSTITUTION_QUALITY_OVERRIDES[`${from}|${to}`];
  if (override) return { quality: override, inferred: false };
  const text = note ?? '';
  if (/失去|略異|部分|不同|不完美|偏/.test(text)) {
    return { quality: 'close', inferred: true };
  }
  const fromCategory = categoryOf.get(from);
  const toCategory = categoryOf.get(to);
  if (fromCategory && toCategory && fromCategory !== toCategory) {
    return { quality: 'cross', inferred: true };
  }
  return { quality: 'same', inferred: true };
}

/** 正規化配方的材料用量。 */
function normalizeRecipeIngredient(raw) {
  const amount = typeof raw.amount === 'number' && Number.isFinite(raw.amount) ? raw.amount : null;
  const unit = cleanString(raw.unit) || null;
  return {
    id: cleanString(raw.id),
    amount,
    unit,
    optional: raw.optional === true,
  };
}

/** 正規化裝飾清單：可能是字串、字串陣列，或帶有 id / zh 的物件陣列。 */
function normalizeGarnish(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const result = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const cleaned = cleanString(item);
      if (cleaned) result.push(cleaned);
    } else if (item && typeof item === 'object') {
      const cleaned = cleanString(item.id) || cleanString(item.zh) || cleanString(item.en);
      if (cleaned) result.push(cleaned);
    }
  }
  return dedupeStrings(result);
}

/** 正規化 collection 值。 */
function normalizeCollection(raw, fallback) {
  const value = cleanString(raw).toLowerCase();
  if (!value) return fallback;
  if (ALLOWED_COLLECTIONS.includes(value)) return value;
  const mapped = COLLECTION_ALIASES[value];
  if (mapped) return mapped;
  stats.unknownCollectionValues.push(`${value}（改用預設值 ${fallback}）`);
  return fallback;
}

/**
 * 正規化單一配方，補上比對引擎所需的 ingredientIds 與 garnishIds。
 */
function normalizeRecipe(raw, source) {
  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : [])
    .map(normalizeRecipeIngredient)
    .filter((item) => item.id !== '');

  const garnish = normalizeGarnish(raw.garnish);

  const recipe = {
    id: cleanString(raw.id),
    nameEn: cleanString(raw.nameEn),
    nameZh: cleanString(raw.nameZh),
    aliases: dedupeStrings(Array.isArray(raw.aliases) ? raw.aliases : []),
    collection: normalizeCollection(raw.collection, source.defaultCollection),
    category: cleanString(raw.category),
    glass: cleanString(raw.glass),
    ice: cleanString(raw.ice),
    difficulty: typeof raw.difficulty === 'number' ? raw.difficulty : 1,
    abv: cleanString(raw.abv),
    time: cleanString(raw.time),
    ingredients,
    steps: (Array.isArray(raw.steps) ? raw.steps : []).map(cleanString).filter(Boolean),
    garnish,
    tags: dedupeStrings(Array.isArray(raw.tags) ? raw.tags : []),
    flavor: dedupeStrings(Array.isArray(raw.flavor) ? raw.flavor : []),
    occasion: dedupeStrings(Array.isArray(raw.occasion) ? raw.occasion : []),
    popularity: typeof raw.popularity === 'number' ? raw.popularity : 0,
    sourceUrl: cleanString(raw.sourceUrl) || source.sourceUrl || '',
    sourceSite: cleanString(raw.sourceSite) || source.site,
    ingredientIds: ingredients.map((item) => item.id),
    garnishIds: garnish,
  };

  // nameZh 不得為空：缺者以英文名或 id 補上，再由驗證關卡把關。
  if (!recipe.nameZh) {
    recipe.nameZh = recipe.nameEn || recipe.id;
    stats.warnings.push(`配方 ${recipe.id} 缺 nameZh，以「${recipe.nameZh}」補上`);
  }

  return recipe;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. 讀取主對照表
  const basePath = path.join(DATA_DIR, 'ingredients.json');
  const base = readJson(basePath, { required: true });
  const baseCategories = base.categories ?? {};
  const ingredientMap = new Map();
  for (const raw of base.ingredients ?? []) {
    const ingredient = normalizeIngredient(raw);
    if (!ingredient.id) continue;
    ingredientMap.set(ingredient.id, ingredient);
  }
  const baseIngredientCount = ingredientMap.size;

  // 2. 讀取各來源，合併 extraIngredients 與配方
  const recipeMap = new Map();
  const extraIngredientSources = [];

  for (const source of SOURCES) {
    const filePath = path.join(DATA_DIR, source.file);
    const data = readJson(filePath, { required: Boolean(source.required) });
    if (!data) continue;

    const site = cleanString(data.source) || source.label;
    const sourceInfo = { ...source, site, sourceUrl: cleanString(data.sourceUrl) };

    for (const raw of data.extraIngredients ?? []) {
      const incoming = normalizeIngredient(raw);
      if (!incoming.id) continue;
      extraIngredientSources.push({ id: incoming.id, source: source.label });
      const existing = ingredientMap.get(incoming.id);
      if (!existing) {
        ingredientMap.set(incoming.id, incoming);
        stats.ingredientsAdded += 1;
        continue;
      }
      const merged = mergeIngredient(existing, incoming);
      const differs =
        existing.zh !== merged.zh ||
        existing.en !== merged.en ||
        existing.category !== merged.category ||
        existing.common !== merged.common ||
        existing.aliases.length !== merged.aliases.length;
      if (differs) {
        stats.ingredientsMerged += 1;
        stats.ingredientConflicts.push(
          `${incoming.id}（來源：${source.label}）` +
            ` 既有 zh=「${existing.zh}」/ common=${existing.common}，` +
            `新 zh=「${incoming.zh}」/ common=${incoming.common}，` +
            `採用 zh=「${merged.zh}」/ common=${merged.common}，aliases 合併為 ${merged.aliases.length} 筆`,
        );
      }
      ingredientMap.set(incoming.id, merged);
    }

    for (const raw of data.recipes ?? []) {
      const recipe = normalizeRecipe(raw, sourceInfo);
      if (!recipe.id) continue;
      const existing = recipeMap.get(recipe.id);
      if (existing) {
        stats.duplicateRecipes.push(
          `${recipe.id}（${existing.collection} 保留，${recipe.collection} 略過）`,
        );
        continue;
      }
      recipeMap.set(recipe.id, recipe);
    }
  }

  const ingredients = [...ingredientMap.values()];
  const categoryOf = new Map(ingredients.map((item) => [item.id, item.category]));

  // 3. 整合替代關係並補上 quality
  const substitutionMap = new Map();
  const substitutionNotes = new Map();
  for (const raw of base.substitutions ?? []) {
    const from = cleanString(raw.from);
    const to = dedupeStrings(Array.isArray(raw.to) ? raw.to : [raw.to]);
    if (!from || to.length === 0) continue;
    const note = cleanString(raw.note);
    substitutionNotes.set(from, note);
    const entries = to.map((target) => {
      const { quality, inferred } = inferSubstitutionQuality(from, target, note, categoryOf);
      if (inferred) stats.inferredRelations += 1;
      else stats.substitutedRelations += 1;
      return { id: target, quality };
    });
    const existing = substitutionMap.get(from);
    if (existing) {
      for (const entry of entries) {
        if (!existing.some((item) => item.id === entry.id)) existing.push(entry);
      }
    } else {
      substitutionMap.set(from, entries);
    }
  }

  for (const extra of EXTRA_SUBSTITUTIONS) {
    const from = cleanString(extra.from);
    if (!ingredientMap.has(from)) continue;
    const entries = extra.to
      .filter((target) => ingredientMap.has(target))
      .map((target) => ({ id: target, quality: extra.quality }));
    if (entries.length === 0) continue;
    const existing = substitutionMap.get(from);
    if (existing) {
      for (const entry of entries) {
        if (!existing.some((item) => item.id === entry.id)) existing.push(entry);
      }
    } else {
      substitutionMap.set(from, entries);
    }
    substitutionNotes.set(from, cleanString(extra.note));
    stats.substitutedRelations += entries.length;
  }

  const substitutions = [...substitutionMap.entries()].map(([from, entries]) => ({
    from,
    to: entries.map((entry) => entry.id),
    note: substitutionNotes.get(from) || '可替代使用',
    quality: entries[0].quality,
    toQualities: entries.map((entry) => ({ id: entry.id, quality: entry.quality })),
  }));

  // 4. 驗證關卡
  const errors = [];

  for (const [id, meta] of Object.entries(baseCategories)) {
    if (!cleanString(meta?.zh)) {
      errors.push(`分類 ${id} 的 zh 為空`);
    }
  }

  const seenRecipeIds = new Set();
  for (const recipe of recipeMap.values()) {
    if (seenRecipeIds.has(recipe.id)) {
      errors.push(`配方 id 重複：${recipe.id}`);
    }
    seenRecipeIds.add(recipe.id);

    if (!recipe.nameZh) {
      errors.push(`配方 ${recipe.id} 的 nameZh 為空字串`);
    }
    for (const item of recipe.ingredients) {
      if (!ingredientMap.has(item.id)) {
        errors.push(`配方 ${recipe.id} 的材料 id「${item.id}」不存在於統一對照表`);
      }
    }
    for (const garnishId of recipe.garnish) {
      if (!ingredientMap.has(garnishId)) {
        errors.push(`配方 ${recipe.id} 的裝飾 id「${garnishId}」不存在於統一對照表`);
      }
    }
  }

  for (const substitution of substitutions) {
    if (!ingredientMap.has(substitution.from)) {
      errors.push(`替代規則的 from「${substitution.from}」不存在於統一對照表`);
    }
    for (const target of substitution.to) {
      if (!ingredientMap.has(target)) {
        errors.push(`替代規則 ${substitution.from} → ${target} 的目標不存在於統一對照表`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('[建置失敗] 驗證未通過，共 ' + errors.length + ' 項問題：');
    for (const error of errors) console.error('  - ' + error);
    process.exit(1);
  }

  // 5. 產出
  const recipes = [...recipeMap.values()];
  for (const recipe of recipes) {
    stats.collectionCounts[recipe.collection] =
      (stats.collectionCounts[recipe.collection] ?? 0) + 1;
  }
  stats.recipesTotal = recipes.length;

  const catalog = {
    version: cleanString(base.version) || '1.0',
    categories: baseCategories,
    ingredients,
    substitutions,
  };

  const dataset = {
    version: cleanString(base.version) || '1.0',
    generatedAt: new Date().toISOString(),
    recipes,
  };

  fs.writeFileSync(
    path.join(OUT_DIR, 'ingredients.json'),
    JSON.stringify(catalog, null, 2) + '\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'cocktails.json'),
    JSON.stringify(dataset, null, 2) + '\n',
    'utf8',
  );

  // 6. 統計
  console.log('=== join 這麼喝：資料管線建置完成 ===');
  console.log(`配方總數：${stats.recipesTotal} 杯`);
  console.log('各系列杯數：');
  for (const [collection, count] of Object.entries(stats.collectionCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${collection}：${count} 杯`);
  }
  console.log(
    `統一食材總數：${ingredients.length} 筆（主對照表 ${baseIngredientCount} 筆 +` +
      ` extraIngredients 新增 ${stats.ingredientsAdded} 筆 + 合併 ${stats.ingredientsMerged} 筆）`,
  );
  console.log(`替代規則：${substitutions.length} 組（人工判定 ${stats.substitutedRelations} 筆、自動推導 ${stats.inferredRelations} 筆）`);
  console.log(`驗證結果：全部通過（${recipes.length} 杯配方的材料與裝飾 id 皆可解析，id 唯一，nameZh 非空）`);

  if (stats.duplicateRecipes.length > 0) {
    console.log(`\n跨來源重複配方（保留優先序較前者的版本，共 ${stats.duplicateRecipes.length} 筆）：`);
    for (const item of stats.duplicateRecipes) console.log('  - ' + item);
  }
  if (stats.ingredientConflicts.length > 0) {
    console.log(`\n食材欄位衝突（依規則合併，共 ${stats.ingredientConflicts.length} 筆）：`);
    for (const item of stats.ingredientConflicts) console.log('  - ' + item);
  }
  if (stats.unknownCollectionValues.length > 0) {
    console.log(`\n無法對應的 collection 值（共 ${stats.unknownCollectionValues.length} 筆）：`);
    for (const item of stats.unknownCollectionValues) console.log('  - ' + item);
  }
  if (stats.warnings.length > 0) {
    console.log('\n警告：');
    for (const item of stats.warnings) console.log('  - ' + item);
  }
}

main();
