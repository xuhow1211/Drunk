#!/usr/bin/env node
/**
 * join 這麼喝：資料管線建置腳本
 *
 * 讀取 data/ 下的原始爬取檔，統整成前端使用的兩份 JSON：
 *   - src/data/ingredients.json：統一食材對照表
 *   - src/data/cocktails.json：全部配方（含比對引擎所需的 id 清單）
 *
 * 兩份檔案同步輸出到 public/data/（內容相同）：
 * src/data/ 供單元測試以 import 引入；public/data/ 供 runtime 以 fetch 載入
 * （JS bundle 不內嵌資料，資料改由 CDN 快取）。
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
/** runtime 資料輸出位置（Vite 會原樣複製 public/ 到建置產物，供 CDN 快取）。 */
const PUBLIC_DATA_DIR = path.join(ROOT_DIR, 'public', 'data');

/**
 * 配方來源，順序即優先序：同一個配方 id 出現於多個來源時，以優先序較前者的欄位為主。
 * 理由：iba-classics 為官方清單，其 collection 分類（classic / new-era）最具權威性。
 *
 * 重要：優先序只決定「欄位以誰為準」，不代表可以丟棄另一來源的資料。
 * 跨來源重複的配方會整併（材料取聯集、collections 取聯集、popularity 取最大值），
 * 詳見 mergeRecipes；否則票選熱門榜會整批消失，且保留版的材料可能比被丟棄版更少，
 * 讓比對引擎誤判缺料。
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

/**
 * 正規化後合法的配方分類。
 *
 * 必須與 src/lib/types.ts 的 RecipeCategory 型別union、以及
 * src/lib/format.ts 的 RECIPE_CATEGORY_LABELS / RECIPE_CATEGORY_HUES 對照表一致。
 * 這份清單是「建置期的第三道防線」：介面端已用 Record<RecipeCategory, string>
 * 讓漏標籤在編譯期就爆錯，但原始爬蟲資料是外部輸入，
 * 若出現未登錄的新分類，建置期就該直接失敗，而不是讓英文標籤漏到中文介面上。
 */
const ALLOWED_CATEGORIES = [
  'flip',
  'aperitivo',
  'sweet',
  'sour',
  'fizzy',
  'spirit-forward',
  'refreshing',
  'highball',
  'daiquiri',
  'digestif',
  'punch',
  'non-alcoholic',
  'shooter',
  'fizz',
];

/**
 * 正規化後合法的杯型。
 *
 * 必須與 src/lib/types.ts 的 GlassType 型別union、以及
 * src/lib/format.ts 的 GLASS_LABELS 對照表一致；理由同 ALLOWED_CATEGORIES。
 */
const ALLOWED_GLASSES = [
  'coupe',
  'rocks',
  'flute',
  'highball',
  'martini',
  'other',
  'collins',
  'wine',
  'mug',
  'tumbler',
  'nick-nora',
  'shot',
];

/** 來源 collection 值到合法 collection 的對照表。 */
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
  /** 跨來源重複配方的整併明細（取代舊有的「略過」清單）。 */
  mergedRecipes: [],
  collectionCounts: {},
  substitutedRelations: 0,
  inferredRelations: 0,
  unknownCollectionValues: [],
  /** sourceUrl 非 http(s) 協定而被清空的紀錄。 */
  sourceUrlViolations: [],
  /** 中文名等同英文名（疑似未翻譯）的配方。 */
  nameZhEnglish: [],
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

/** 讀取 JSON 檔案；檔案不存在或解析失敗時回傳 null（用於比對前一次產物）。 */
function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 將同一份 JSON 同步寫入 src/data 與 public/data 兩處。
 *
 * 內容完全相同：src/data 供單元測試 import；public/data 供 runtime fetch。
 *
 * @param {string} fileName 檔名
 * @param {string} content JSON 字串
 */
function writeOut(fileName, content) {
  const text = content + '\n';
  fs.writeFileSync(path.join(OUT_DIR, fileName), text, 'utf8');
  fs.writeFileSync(path.join(PUBLIC_DATA_DIR, fileName), text, 'utf8');
}

/**
 * 決定產物的 generatedAt。
 *
 * 只有在配方或食材內容實際變動時才更新時間戳；內容未變則沿用前一次的時間戳。
 * 理由：時間戳每次都會變，會讓 git diff 出現無意義的雜訊，
 * 「資料是否同步」的檢查（data:check）便無法分辨真正的內容變動。
 *
 * @param {object[]} recipes 本次建置的配方
 * @param {object} catalog 本次建置的食材目錄
 * @returns {string} ISO 8601 時間戳
 */
function resolveGeneratedAt(recipes, catalog) {
  const previousDataset = readJsonIfExists(path.join(OUT_DIR, 'cocktails.json'));
  const previousCatalog = readJsonIfExists(path.join(OUT_DIR, 'ingredients.json'));
  const unchanged =
    previousDataset !== null &&
    previousCatalog !== null &&
    JSON.stringify(previousDataset.recipes ?? null) === JSON.stringify(recipes) &&
    JSON.stringify(previousCatalog) === JSON.stringify(catalog);
  if (unchanged && typeof previousDataset.generatedAt === 'string' && previousDataset.generatedAt) {
    return previousDataset.generatedAt;
  }
  return new Date().toISOString();
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

/** 允許的來源網址協定：僅 http 與 https。 */
const HTTP_URL_PATTERN = /^https?:\/\//i;

/**
 * 依 http(s) 白名單過濾來源網址。
 *
 * 爬蟲資料不受信任：偽協定（javascript:、data: 等）若原樣進入 href，
 * 使用者點擊就會執行非預期腳本，因此非 http(s) 的值一律清空為 null，
 * 並記入警告清單供追查來源。
 *
 * @param {unknown} value 原始網址
 * @param {string} context 紀錄用的說明（通常是配方 id）
 * @returns {string | null} 合法網址；不合法或空值時為 null
 */
function sanitizeSourceUrl(value, context) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  if (HTTP_URL_PATTERN.test(cleaned)) return cleaned;
  stats.sourceUrlViolations.push(`${context}：${cleaned}`);
  return null;
}

/**
 * 判斷配方是否帶有「有效的中文名」。
 *
 * 中文名等於英文名等同於沒有翻譯，中文站不該直接顯示英文，
 * 因此這類配方在整併時視為缺中文名處理。
 *
 * @param {object} recipe 已正規化的配方
 * @returns {boolean} 是否有有效中文名
 */
function hasChineseName(recipe) {
  const zh = cleanString(recipe.nameZh);
  if (!zh) return false;
  const en = cleanString(recipe.nameEn);
  return en === '' || zh !== en;
}

/**
 * 整併同一 id 的兩份配方。
 *
 * 設計原則：優先來源決定「欄位以誰為準」，但另一來源的獨有資料不得遺失。
 *   - 材料：取聯集。同一材料 id 以優先來源的 amount / unit 為準（IBA 用量較權威），
 *           另一來源的獨有材料附加在後，並沿用其 amount / unit / optional。
 *   - collections：取聯集。一杯酒可同時屬於多個系列（例如既是 IBA 經典也是票選熱門）。
 *   - popularity：取最大值，避免熱門度被較低者覆蓋。
 *   - 其他欄位：以優先來源為主；優先來源該欄位為空而另一方有值時採用另一方的值。
 *
 * @param {object} primary 優先來源的配方（已被整併過的既有版本）
 * @param {object} secondary 另一來源的配方
 * @returns {object} 整併後的配方
 */
function mergeRecipes(primary, secondary) {
  const primaryIngredientIds = new Set(primary.ingredients.map((item) => item.id));
  const ingredients = [
    ...primary.ingredients,
    ...secondary.ingredients.filter((item) => !primaryIngredientIds.has(item.id)),
  ];

  const merged = { ...primary };
  merged.ingredients = ingredients;
  merged.ingredientIds = ingredients.map((item) => item.id);
  merged.collections = dedupeStrings([...primary.collections, ...secondary.collections]);
  merged.collection = merged.collections[0] ?? primary.collection;
  merged.popularity = Math.max(primary.popularity, secondary.popularity);

  // 文字欄位：優先來源為空時改用另一方
  for (const key of ['nameEn', 'category', 'glass', 'ice', 'abv', 'time', 'sourceUrl', 'sourceSite']) {
    if (!cleanString(merged[key]) && cleanString(secondary[key])) {
      merged[key] = secondary[key];
    }
  }

  // 陣列欄位：優先來源為空陣列時改用另一方
  for (const key of ['aliases', 'steps', 'tags', 'flavor', 'occasion', 'garnish']) {
    const current = merged[key];
    const incoming = secondary[key];
    if (Array.isArray(current) && current.length === 0 && Array.isArray(incoming) && incoming.length > 0) {
      merged[key] = incoming;
    }
  }

  // 中文名：優先來源的中文名等同英文名（未翻譯）時，改採另一方的中文名
  if (!hasChineseName(primary) && hasChineseName(secondary)) {
    merged.nameZh = secondary.nameZh;
  }

  // 難度：優先來源沒有有效數值時才改用另一方
  if (!(merged.difficulty > 0) && secondary.difficulty > 0) {
    merged.difficulty = secondary.difficulty;
  }

  merged.garnishIds = merged.garnish;
  return merged;
}

/**
 * 原始資料只有英文名的配方，在此補上繁體中文譯名。
 *
 * 這幾杯在爬蟲來源中沒有中文名（nameZh 直接等於 nameEn），
 * 中文站不該把英文名當成中文名顯示，因此在正規化階段直接補上譯名。
 * 原始爬蟲資料（data/*.json）維持原樣不動，譯名只存在於本建置腳本。
 *
 * - baco-tell：以百加得 151 蘭姆為基酒的自製氣泡調酒。
 * - chill-gpt：以高粱、黃瓜與蘇打水調成的清涼氣泡飲（原始別名亦作「高粱黃瓜氣泡」）。
 */
const CHINESE_NAME_OVERRIDES = {
  'baco-tell': '百加得 151 蘭姆',
  'chill-gpt': '高粱黃瓜氣泡',
};

/**
 * 正規化單一配方，補上比對引擎所需的 ingredientIds 與 garnishIds。
 */
function normalizeRecipe(raw, source) {
  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : [])
    .map(normalizeRecipeIngredient)
    .filter((item) => item.id !== '');

  const garnish = normalizeGarnish(raw.garnish);

  const collection = normalizeCollection(raw.collection, source.defaultCollection);
  const id = cleanString(raw.id);

  const recipe = {
    id,
    nameEn: cleanString(raw.nameEn),
    nameZh: CHINESE_NAME_OVERRIDES[id] ?? cleanString(raw.nameZh),
    aliases: dedupeStrings(Array.isArray(raw.aliases) ? raw.aliases : []),
    collection,
    /** 配方所屬的全部系列；單一來源時只有一項，跨來源整併後會有多項。 */
    collections: [collection],
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
    sourceUrl: sanitizeSourceUrl(cleanString(raw.sourceUrl) || source.sourceUrl, `配方 ${id}`),
    sourceSite: cleanString(raw.sourceSite) || source.site,
    ingredientIds: ingredients.map((item) => item.id),
    garnishIds: garnish,
  };

  // nameZh 不得為空：缺者以英文名或 id 補上，再由驗證關卡把關。
  if (!recipe.nameZh) {
    recipe.nameZh = recipe.nameEn || recipe.id;
  }

  return recipe;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });

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
  /** 配方 id → 優先來源標籤，供整併明細顯示用。 */
  const recipeSourceLabels = new Map();
  const extraIngredientSources = [];

  for (const source of SOURCES) {
    const filePath = path.join(DATA_DIR, source.file);
    const data = readJson(filePath, { required: Boolean(source.required) });
    if (!data) continue;

    const site = cleanString(data.source) || source.label;
    // 來源層級的網址同樣不可信，先過濾一次，避免同一筆違規被每個配方重複記錄
    const sourceInfo = {
      ...source,
      site,
      sourceUrl: sanitizeSourceUrl(data.sourceUrl, `來源檔 ${source.file}`),
    };

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
        // 跨來源重複：不整份丟棄，改為整併（材料聯集、collections 聯集、popularity 取最大）
        const merged = mergeRecipes(existing, recipe);
        recipeMap.set(recipe.id, merged);
        stats.mergedRecipes.push({
          id: recipe.id,
          primarySource: recipeSourceLabels.get(recipe.id) ?? source.label,
          secondarySource: source.label,
          primaryIngredients: existing.ingredients.length,
          secondaryIngredients: recipe.ingredients.length,
          mergedIngredients: merged.ingredients.length,
          primaryPopularity: existing.popularity,
          secondaryPopularity: recipe.popularity,
          mergedPopularity: merged.popularity,
          collections: merged.collections,
        });
        continue;
      }
      recipeMap.set(recipe.id, recipe);
      recipeSourceLabels.set(recipe.id, source.label);
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
  // 驗證對象是「即將寫出的產物」，目的是在建置期擋下前端才會發現的資料問題。
  const errors = [];
  const recipes = [...recipeMap.values()];

  for (const [id, meta] of Object.entries(baseCategories)) {
    if (!cleanString(meta?.zh)) {
      errors.push(`分類 ${id} 的 zh 為空`);
    }
  }

  for (const recipe of recipes) {
    // 驗證一：用量有值時必須有單位，否則抽屜會顯示裸數字（例如「50」）。
    for (const item of recipe.ingredients) {
      if (item.amount !== null && item.unit === null) {
        errors.push(`配方 ${recipe.id} 的材料「${item.id}」有用量 ${item.amount} 但缺單位`);
      }
    }

    // 驗證二：步驟不可為空，否則抽屜會出現有標題無內容的區塊。
    if (recipe.steps.length === 0) {
      errors.push(`配方 ${recipe.id} 的 steps 為空`);
    }

    // 驗證三：sourceUrl 只能是 null 或 http(s)。
    // 正規化階段已依白名單清空非法值，此處檢查最終產出，
    // 確保沒有任何寫入路徑（例如日後新增的欄位或整併邏輯）繞過該過濾。
    if (recipe.sourceUrl !== null && !HTTP_URL_PATTERN.test(recipe.sourceUrl)) {
      errors.push(`配方 ${recipe.id} 的 sourceUrl 非 http(s) 協定：${recipe.sourceUrl}`);
    }

    // 驗證四：材料與裝飾 id 必須存在於統一對照表。
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

    // 驗證五：分類與杯型必須在合法清單內。
    // 未登錄的值在介面上沒有繁中標籤，會直接漏出英文（shooter、fizz、shot 等），
    // 因此視為建置期錯誤，強迫補上對照表與型別union後才能建置。
    if (!ALLOWED_CATEGORIES.includes(recipe.category)) {
      errors.push(`配方 ${recipe.id} 的分類「${recipe.category}」未登錄於合法分類清單`);
    }
    if (!ALLOWED_GLASSES.includes(recipe.glass)) {
      errors.push(`配方 ${recipe.id} 的杯型「${recipe.glass}」未登錄於合法杯型清單`);
    }

    // 警告（非阻斷）：中文名等同英文名代表尚未翻譯，中文站不該直接顯示英文。
    if (!hasChineseName(recipe)) {
      stats.nameZhEnglish.push(`${recipe.id}：${recipe.nameZh}`);
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
  stats.recipesTotal = recipes.length;
  for (const recipe of recipes) {
    // 同一杯可同屬多個系列，因此各系列的杯數會大於配方總數
    for (const collection of recipe.collections) {
      stats.collectionCounts[collection] = (stats.collectionCounts[collection] ?? 0) + 1;
    }
  }

  const catalog = {
    version: cleanString(base.version) || '1.0',
    categories: baseCategories,
    ingredients,
    substitutions,
  };

  const dataset = {
    version: cleanString(base.version) || '1.0',
    generatedAt: resolveGeneratedAt(recipes, catalog),
    recipes,
  };

  writeOut('ingredients.json', JSON.stringify(catalog, null, 2));
  writeOut('cocktails.json', JSON.stringify(dataset, null, 2));

  // 6. 統計
  const popularCount = stats.collectionCounts.popular ?? 0;
  const classicCount = (stats.collectionCounts.classic ?? 0) + (stats.collectionCounts['new-era'] ?? 0);

  console.log('=== join 這麼喝：資料管線建置完成 ===');
  console.log(`配方總數：${stats.recipesTotal} 杯`);
  console.log('各系列杯數（同一杯可同時屬於多個系列）：');
  for (const [collection, count] of Object.entries(stats.collectionCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${collection}：${count} 杯`);
  }
  console.log(`/popular 頁面：${popularCount} 杯`);
  console.log(`/classic + /new-era 頁面：${classicCount} 杯`);
  console.log(
    `統一食材總數：${ingredients.length} 筆（主對照表 ${baseIngredientCount} 筆 +` +
      ` extraIngredients 新增 ${stats.ingredientsAdded} 筆 + 合併 ${stats.ingredientsMerged} 筆）`,
  );
  console.log(
    `食材欄位衝突：${stats.ingredientConflicts.length} 筆（超過 0 筆時列為警告，但不阻斷建置）`,
  );
  console.log(`替代規則：${substitutions.length} 組（人工判定 ${stats.substitutedRelations} 筆、自動推導 ${stats.inferredRelations} 筆）`);
  console.log(
    `驗證結果：全部通過（${recipes.length} 杯配方的用量皆有單位、步驟皆非空、` +
      `sourceUrl 皆為 http(s) 或空值、材料與裝飾 id 皆可解析）`,
  );

  if (stats.mergedRecipes.length > 0) {
    console.log(
      `\n跨來源重複配方整併（材料取聯集、collections 取聯集、popularity 取最大值，` +
        `共 ${stats.mergedRecipes.length} 杯）：`,
    );
    for (const item of stats.mergedRecipes) {
      console.log(
        `  - ${item.id}：` +
          `${item.primarySource}（材料 ${item.primaryIngredients} 項／熱門度 ${item.primaryPopularity}）` +
          ` + ${item.secondarySource}（材料 ${item.secondaryIngredients} 項／熱門度 ${item.secondaryPopularity}）` +
          ` → 材料 ${item.mergedIngredients} 項／熱門度 ${item.mergedPopularity}／系列 ${item.collections.join('、')}`,
      );
    }
  }
  if (stats.ingredientConflicts.length > 0) {
    // 衝突以統計與警告呈現，不阻斷建置：食材欄位衝突已有明確的合併規則，
    // 合法資料不應因此建置失敗，但數量必須被看見。
    console.log(
      `\n[警告] 食材欄位衝突（依規則合併，共 ${stats.ingredientConflicts.length} 筆）：`,
    );
    for (const item of stats.ingredientConflicts) console.log('  - ' + item);
  }
  if (stats.sourceUrlViolations.length > 0) {
    console.log(
      `\n[警告] sourceUrl 非 http(s) 協定已清空（共 ${stats.sourceUrlViolations.length} 筆）：`,
    );
    for (const item of stats.sourceUrlViolations) console.log('  - ' + item);
  }
  if (stats.nameZhEnglish.length > 0) {
    console.log(
      `\n[警告] 中文名等同英文名、尚未翻譯（共 ${stats.nameZhEnglish.length} 杯）：`,
    );
    for (const item of stats.nameZhEnglish) console.log('  - ' + item);
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
