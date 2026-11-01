/**
 * 領域型別定義（join 這麼喝）
 *
 * 本檔是資料管線（scripts/build-data.mjs 產出的 JSON）與前端比對引擎之間的型別契約。
 * 階段 3 的介面開發請以本檔的型別為準，避免欄位命名不一致。
 */

/** 食材分類。決定該食材在缺料計分中的權重。 */
export type IngredientCategory =
  | 'base-spirit'
  | 'fortified-wine'
  | 'liqueur'
  | 'syrup'
  | 'bitter'
  | 'mixer'
  | 'dairy'
  | 'wine'
  | 'tea-coffee'
  | 'garnish';

/** 單一食材（統一對照表的一筆紀錄）。 */
export interface Ingredient {
  /** 唯一識別碼，全域唯一，配方以本欄位引用食材。 */
  id: string;
  /** 繁體中文名稱（台灣用語）。 */
  zh: string;
  /** 英文名稱。 */
  en: string;
  /** 食材分類，用於缺料計分權重與介面分組。 */
  category: IngredientCategory;
  /** 是否為台灣便利商店等處的常備食材（供快捷選取區使用）。 */
  common: boolean;
  /** 別名（含台灣慣用說法），供搜尋使用。 */
  aliases: string[];
}

/** 替代品質。數值越大代表替代品與原物料越接近。 */
export type SubstitutionQuality = 'same' | 'close' | 'cross';

/**
 * 替代品質對應的缺料折扣率。
 *
 * 完全同調性（same）= 100%：替代品可完全補足原物料功能，缺料成本降到下限。
 * 風味偏移（close）= 70%：替代品大致可用，缺料成本減輕三成。
 * 跨類別（cross）= 40%：替代品性質不同，只能勉強頂替，缺料成本減輕四成。
 */
export const SUBSTITUTION_DISCOUNT_RATE: Record<SubstitutionQuality, number> = {
  same: 1,
  close: 0.7,
  cross: 0.4,
};

/**
 * 缺料權重的最低保留比例。
 *
 * 替代品只能減輕缺料成本，不能讓缺料成本歸零（替代品不消除缺料分數），
 * 因此折後權重不得低於原權重的 30%。
 */
export const MIN_RETAINED_WEIGHT_RATIO = 0.3;

/**
 * 缺料權重保留比例（= max(1 − 折扣率, 最低保留比例)）。
 *
 * same = 30%（完全同調，折扣率 100% 受下限保護）、close = 30%、cross = 60%。
 * 這裡直接寫死數值而非由折扣率推導，避免浮點運算誤差。
 */
export const SUBSTITUTION_RETAINED_RATIO: Record<SubstitutionQuality, number> = {
  same: 0.3,
  close: 0.3,
  cross: 0.6,
};

/** 單條替代規則：由 `from` 指定的食材，可改用 `to` 內任一食材。 */
export interface Substitution {
  /** 被替代的食材 id。 */
  from: string;
  /** 可替代的食材 id 清單。 */
  to: string[];
  /** 替代說明（繁體中文）。 */
  note: string;
  /** 整組替代關係的代表品質，供介面概略顯示。 */
  quality: SubstitutionQuality;
  /**
   * 每個替代目標各自的品質。
   *
   * 同一組的 to 可能有不同品質（例如 simple-syrup 的蜂蜜糖漿是同調性、
   * 紅石榴糖漿則為風味偏移），計分時須逐筆判斷。
   */
  toQualities: { id: string; quality: SubstitutionQuality }[];
}

/** 分類的中文名稱與顯示順序。 */
export interface CategoryMeta {
  /** 分類的中文名稱。 */
  zh: string;
  /** 顯示順序，數字越小越前面。 */
  order: number;
}

/** 統一食材對照表（src/data/ingredients.json）。 */
export interface IngredientCatalog {
  /** 資料版本。 */
  version: string;
  /** 各分類的中文名稱與順序。 */
  categories: Record<string, CategoryMeta>;
  /** 全部食材。 */
  ingredients: Ingredient[];
  /** 全部替代規則。 */
  substitutions: Substitution[];
}

/** 配方中的一項材料用量。 */
export interface RecipeIngredient {
  /** 食材 id，必須存在於統一對照表。 */
  id: string;
  /** 用量數值；來源未提供時為 null（介面顯示「依口味調整」）。 */
  amount: number | null;
  /** 用量單位；來源未提供時為 null。 */
  unit: string | null;
  /** 是否為可省略材料。 */
  optional: boolean;
}

/** 配方所屬的系列分類。 */
export type Collection =
  | 'classic'
  | 'new-era'
  | 'popular'
  | 'mocktail'
  | 'shot'
  | 'easy'
  | 'taiwan'
  | 'seasonal';

/** 一杯調酒的完整配方。 */
export interface Recipe {
  /** 配方唯一識別碼，全域唯一。 */
  id: string;
  /** 英文名稱。 */
  nameEn: string;
  /** 繁體中文名稱，不得為空字串。 */
  nameZh: string;
  /** 別名，供搜尋使用。 */
  aliases: string[];
  /**
   * 配方系列分類（主要系列）。
   *
   * 定義為 `collections[0]`，保留此欄位是為了相容既有程式；
   * 一杯酒可能同時屬於多個系列（例如既是 IBA 經典也是票選熱門），
   * 系列篩選一律以 `collections` 為準。
   */
  collection: Collection;
  /**
   * 配方所屬的全部系列。
   *
   * 同一杯酒出現在多個資料來源時會整併（材料取聯集、熱門度取最大值），
   * 各來源的系列會一併保留，因此同一杯可能同時出現在多個瀏覽頁面。
   */
  collections: Collection[];
  /** 調酒類型（flip、sour、highball 等）。 */
  category: string;
  /** 建議杯型。 */
  glass: string;
  /** 調法（shaken、stirred 等）。 */
  ice: string;
  /** 難度 1 至 3。 */
  difficulty: number;
  /** 酒精濃度說明。 */
  abv: string;
  /** 製作時間說明。 */
  time: string;
  /** 材料清單。 */
  ingredients: RecipeIngredient[];
  /** 製作步驟。 */
  steps: string[];
  /** 裝飾食材 id 清單。 */
  garnish: string[];
  /** 分類標籤。 */
  tags: string[];
  /** 風味標籤。 */
  flavor: string[];
  /** 場合標籤。 */
  occasion: string[];
  /** 熱門度（數字越大越熱門）。 */
  popularity: number;
  /** 來源網址；建置期已過濾非 http(s) 協定，沒有合法網址時為 null。 */
  sourceUrl: string | null;
  /** 來源網站名稱。 */
  sourceSite?: string;
  /** 所有材料（不含裝飾）的食材 id，供比對引擎快速取用。 */
  ingredientIds: string[];
  /** 所有裝飾的食材 id，供比對引擎快速取用。 */
  garnishIds: string[];
}

/** 配方資料集（src/data/cocktails.json）。 */
export interface CocktailDataset {
  /** 資料版本。 */
  version: string;
  /** 產製時間（ISO 8601）。 */
  generatedAt: string;
  /** 全部配方。 */
  recipes: Recipe[];
}

/** 缺料項目中的替代建議。 */
export interface SubstituteOption {
  /** 可替代的食材 id。 */
  id: string;
  /** 替代品的中文名稱。 */
  zh: string;
  /** 替代品質。 */
  quality: SubstitutionQuality;
}

/** 比對結果中的一項缺料。 */
export interface MissingItem {
  /** 缺少的食材 id。 */
  id: string;
  /** 缺少的食材中文名稱。 */
  zh: string;
  /** 缺少的食材英文名稱。 */
  en: string;
  /** 計分用的有效權重（已套用替代折扣，且不低於原權重的 30%）。 */
  weight: number;
  /** 原始分類權重（未套用替代折扣），供介面顯示「缺基酒 45 分」之類的提示。 */
  baseWeight: number;
  /** 手邊已有、可替代此食材的建議。 */
  substitutes: SubstituteOption[];
  /** 缺少的食材分類。 */
  category: IngredientCategory;
}

/** 選用材料中缺少的項目（不計入缺料數與缺料分數，但介面仍要標示）。 */
export interface OptionalMissingItem {
  /** 缺少的食材 id。 */
  id: string;
  /** 缺少的食材中文名稱。 */
  zh: string;
  /** 缺少的食材英文名稱。 */
  en: string;
  /** 缺少的食材分類。 */
  category: IngredientCategory;
}

/** 單杯配方的比對結果。 */
export interface MatchResult {
  /** 原始配方。 */
  recipe: Recipe;
  /** 加權缺料總分，越低代表越接近調得出來。 */
  score: number;
  /** 缺料清單（已依權重由高至低排序）。 */
  missing: MissingItem[];
  /**
   * 缺少的選用材料。
   *
   * 只有在比對選項 includeOptional 為 false 時才會有內容；
   * 這些材料不計入缺料數與缺料分數，但介面仍以較弱的樣式標示出來，
   * 讓使用者知道「這杯還可以加點冰塊之類的選用材料」。
   */
  optionalMissing: OptionalMissingItem[];
  /** 已備材料數除以材料總數，介於 0 至 1。 */
  matchedRatio: number;
  /** 是否零缺料（手邊材料完全足夠）。 */
  isFullyAvailable: boolean;
  /** 缺料是否包含基酒（用於「你真正缺的是主酒」提示）。 */
  missingBaseSpirit: boolean;
}

/** 比對引擎的選項。 */
export interface MatchOptions {
  /** 是否把裝飾材料納入計分（預設 true）。 */
  includeGarnish?: boolean;
  /** 是否把可省略材料納入計分（預設 true）。 */
  includeOptional?: boolean;
  /** 缺料數上限，超過者不列入結果。 */
  maxMissing?: number;
}
