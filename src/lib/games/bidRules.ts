/**
 * 喊牌規則的純函式（不含副作用，供單元測試直接覆蓋）。
 *
 * 前端僅用於顯示與送出前的初步檢查，真正的裁判在 supabase/game-core.sql
 * 的 submit_bid（同一條件式，萬用骰規則以 1 點計入）。
 */

/** 一筆喊牌（數量＋點數）。 */
export interface Bid {
  /** 宣稱符合的骰子數量。 */
  count: number;
  /** 宣稱的點數（1～6；1 為萬用骰）。 */
  face: number;
}

/** 喊牌點數的合法範圍（含）。 */
export const BID_FACE_RANGE = { min: 1, max: 6 } as const;

/**
 * 驗證喊牌是否合法（含面數 1～6、正整數與加碼規則）。
 *
 * 加碼規則：無前喊時任何合法值可喊；有前喊時須「數量更多」，
 * 或「數量相同且點數更高」。
 *
 * @param prev 上一筆喊牌（bid_seq 為 0、尚未有人喊牌時帶 null）
 * @param count 欲喊的數量
 * @param face 欲喊的點數
 */
export function isValidBid(
  prev: Bid | null,
  count: number,
  face: number,
): boolean {
  if (!Number.isInteger(count) || count < 1) return false;
  if (!Number.isInteger(face) || face < BID_FACE_RANGE.min || face > BID_FACE_RANGE.max) {
    return false;
  }
  if (prev === null) return true;
  return count > prev.count || (count === prev.count && face > prev.face);
}

/**
 * 計算一組骰子中符合喊牌點數的數量（萬用骰規則：喊 2～6 點時 1 點一併計入；
 * 喊 1 點時只數 1 點）。與 SQL 的開盅彙總同一條件式。
 *
 * @param dice 單一玩家的骰子陣列（值 1～6）
 * @param face 喊牌的點數
 */
export function matchingCount(dice: number[], face: number): number {
  if (!dice.length) return 0;
  if (face === BID_FACE_RANGE.min) {
    return dice.filter((value) => value === face).length;
  }
  return dice.filter((value) => value === face || value === BID_FACE_RANGE.min).length;
}
