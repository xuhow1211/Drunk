/**
 * 介面顯示用的格式化與對照表。
 *
 * 資料集內的若干欄位是英文原始值或帶單位的中文字串
 * （例如 abv 為「約 22%」、time 為「4 分鐘」、glass 為「rocks」），
 * 介面需要先解析或翻譯才能顯示，本檔集中處理這些轉換。
 */

/** 調酒類型（recipe.category）的中文對照。 */
export const RECIPE_CATEGORY_LABELS: Record<string, string> = {
  flip: '翻轉類 Flip',
  sour: '酸甜類 Sour',
  'spirit-forward': '烈酒型 Spirit-forward',
  highball: '高球類 Highball',
  sweet: '甜味類 Sweet',
  fizzy: '氣泡類 Fizzy',
  refreshing: '清爽類 Refreshing',
  aperitivo: '開胃酒 Aperitivo',
  daiquiri: '代基里 Daiquiri',
  punch: '潘趣 Punch',
  digestif: '餐後酒 Digestif',
  'non-alcoholic': '無酒精 Non-alcoholic',
};

/** 杯型（recipe.glass）的中文對照。 */
export const GLASS_LABELS: Record<string, string> = {
  coupe: '淺碟杯',
  rocks: '古典杯',
  flute: '香檳杯',
  highball: '高球杯',
  martini: '馬天尼杯',
  collins: '可林杯',
  wine: '葡萄酒杯',
  mug: '啤酒杯',
  tumbler: '威士忌杯',
  'nick-nora': '尼可拉杯',
  other: '其他杯型',
};

/** 加冰方式（recipe.ice）的中文對照。 */
export const ICE_LABELS: Record<string, string> = {
  shaken: '搖盪',
  stirred: '攪拌',
  'large-cube': '大冰塊',
  none: '不加冰',
  crushed: '碎冰',
};

/** 風味標籤（recipe.flavor）的中文對照。 */
export const FLAVOR_LABELS: Record<string, string> = {
  creamy: '奶油',
  sweet: '甜',
  coffee: '咖啡',
  bitter: '苦味',
  herbal: '草本',
  citrus: '柑橘',
  fruity: '果香',
  sour: '酸',
  fizzy: '氣泡',
  spicy: '辛香',
  nutty: '堅果',
};

/** 配方系列（recipe.collection）的中文對照。 */
export const COLLECTION_LABELS: Record<string, string> = {
  classic: 'IBA 經典',
  'new-era': '新時代',
  popular: '票選熱門',
  mocktail: '無酒精',
  shot: '一口-shot',
  easy: '新手友善',
  taiwan: '台灣風味',
  seasonal: '季節限定',
};

/** 難度 1 至 3 的中文標示。 */
export const DIFFICULTY_LABELS: readonly string[] = ['簡單', '中等', '進階'];

/**
 * 各調酒類型的色相（0 至 360），用於產生漸層色票。
 * 每個類型給固定色相，讓同一類型在整站維持一致配色。
 */
export const RECIPE_CATEGORY_HUES: Record<string, number> = {
  flip: 285,
  sour: 190,
  'spirit-forward': 265,
  highball: 205,
  sweet: 330,
  fizzy: 175,
  refreshing: 155,
  aperitivo: 20,
  daiquiri: 45,
  punch: 300,
  digestif: 15,
  'non-alcoholic': 120,
};

/**
 * 解析酒精濃度字串，取出百分比數值。
 *
 * 資料集中的格式為「約 22%」或「0%」，一律取出第一組數字；
 * 無法解析時回傳 null（介面仍可顯示原字串，但不納入區間篩選）。
 *
 * @param abv 原始酒精濃度字串
 */
export function parseAbv(abv: string): number | null {
  const matched = /(\d+(?:\.\d+)?)/.exec(abv);
  if (!matched || matched[1] === undefined) return null;
  const value = Number.parseFloat(matched[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * 解析製作時間字串，取出分鐘數。
 *
 * 資料集中的格式為「4 分鐘」，一律取出第一組整數；
 * 無法解析時回傳 null（排序時視為最末）。
 *
 * @param time 原始製作時間字串
 */
export function parseMinutes(time: string): number | null {
  const matched = /(\d+)/.exec(time);
  if (!matched || matched[1] === undefined) return null;
  const value = Number.parseInt(matched[1], 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * 取得調酒類型的色票漸層字串。
 *
 * @param category 調酒類型
 */
export function categoryGradient(category: string): string {
  const hue = RECIPE_CATEGORY_HUES[category] ?? 270;
  return `linear-gradient(140deg, hsl(${hue} 80% 44% / 0.95), hsl(${(hue + 30) % 360} 78% 31% / 0.92))`;
}

/**
 * 取得調酒類型的霓虹外框色。
 *
 * @param category 調酒類型
 */
export function categoryAccent(category: string): string {
  const hue = RECIPE_CATEGORY_HUES[category] ?? 270;
  return `hsl(${hue} 85% 66%)`;
}
