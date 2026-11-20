/**
 * 房間輸入與設定的純邏輯驗證（不含副作用，供單元測試直接覆蓋）。
 *
 * 房間 ID 的字元集與 supabase/game-rooms.sql 的 generate_room_id() 一致：
 * 去掉易混淆的 I、L、O 與 0、1；前端一律將輸入轉大寫後送出。
 */

/** 房間 ID 的合法字元（與 SQL 的字元集一致）。 */
const ROOM_ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 房間 ID 的長度上限（固定 6 碼）。 */
export const ROOM_ID_LENGTH = 6;

/** 房間 ID 合法性的檢查用正規表示式（大寫英數、排除易混淆的 I L O 與 0 1）。 */
export const ROOM_ID_PATTERN = /^[A-HJKMNP-Z2-9]{6}$/;

/** 每人骰子數的可設範圍。 */
export const DICE_COUNT_RANGE = { min: 2, max: 5 } as const;

/** 每回合思考秒數的可設範圍。 */
export const TURN_SECONDS_RANGE = { min: 5, max: 30 } as const;

/** 房間人數上限（與 SQL 的觸發器守門一致）。 */
export const ROOM_MAX_PLAYERS = 8;

/**
 * 把使用者輸入的正規化成房間 ID 候選字串：
 * 轉大寫、移除非合法字元的空白與符號，並截斷到 6 碼。
 *
 * @param raw 使用者輸入的原始字串
 */
export function normalizeRoomInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_ID_LENGTH);
}

/**
 * 驗證房間 ID 輸入，通過時回傳 null，否則回傳可直接顯示的繁中訊息。
 *
 * @param raw 已正規化（大寫、純英數）的輸入
 */
export function validateRoomInput(raw: string): string | null {
  if (raw.length === 0) return '請輸入 6 碼房間 ID。';
  if (raw.length < ROOM_ID_LENGTH) return '房間 ID 需要 6 碼，請確認後再輸入。';
  for (const char of raw) {
    if (!ROOM_ID_CHARS.includes(char)) {
      return '房間 ID 含有不支援的字元（不含 I、L、O、0、1）。';
    }
  }
  return null;
}

/**
 * 把數值夾在範圍內（含非法輸入退化為邊界值），供設定控制項與送出前使用。
 *
 * @param value 目前值
 * @param min 最小值（含）
 * @param max 最大值（含）
 */
export function clampInRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
