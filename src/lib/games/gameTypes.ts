/**
 * 吹牛骰子遊戲核心：局況、回合、玩家狀態與開盅資料型別
 * （Supabase snake_case → 前端 camelCase）。
 */

/** 遊戲回合的狀態（與 SQL 的 check 一致）。 */
export type GameRoundStatus = 'bidding' | 'resolving' | 'round_end' | 'ended';

/** game_sessions 的單列（原始形狀）。 */
export interface GameSessionRow {
  /** 局 ID（bigint identity，JSON 中為數字）。 */
  id: number;
  /** 房間 ID（6 碼英數）。 */
  room_id: string;
  /** 每人起始骰子數。 */
  dice_count: number;
  /** 每回合思考秒數。 */
  turn_seconds: number;
  /** 開局時間。 */
  started_at: string;
  /** 勝者（結算後才有值）。 */
  winner: string | null;
  /** 結束時間（結算後才有值）。 */
  ended_at: string | null;
  /** 統計結算時間（冪等結算的守門欄位）。 */
  settled_at: string | null;
}

/** 前端使用的局況快照（camelCase）。 */
export interface GameSession {
  /** 局 ID。 */
  sessionId: number;
  /** 房間 ID（6 碼英數）。 */
  roomId: string;
  /** 每人起始骰子數。 */
  diceCount: number;
  /** 每回合思考秒數。 */
  turnSeconds: number;
  /** 開局時間。 */
  startedAt: string;
  /** 勝者（結算後才有值）。 */
  winner: string | null;
  /** 結束時間（結算後才有值）。 */
  endedAt: string | null;
}

/** 開盅時 reveal 欄位中的單位條目（全員骰子公開）。 */
export interface RevealEntry {
  /** 玩家 user_id。 */
  user_id: string;
  /** 該玩家本回合的骰子（1～6）。 */
  dice: number[];
}

/** game_rounds 的單列（原始形狀）。 */
export interface GameRoundRow {
  /** 局 ID。 */
  session_id: number;
  /** 回合編號（1 起算）。 */
  round_no: number;
  /** 目前要操作的座位。 */
  current_seat: number;
  /** 目前喊牌數量（尚未喊牌為 null）。 */
  bid_count: number | null;
  /** 目前喊牌點數（尚未喊牌為 null）。 */
  bid_face: number | null;
  /** 目前喊牌者（尚未喊牌為 null）。 */
  bid_user: string | null;
  /** 本回合第幾手（0 表示尚未喊牌）。 */
  bid_seq: number;
  /** 本手截止時間（逾時判定與倒數的依據）。 */
  deadline_at: string;
  /** 回合狀態。 */
  status: GameRoundStatus;
  /** 開盅後的全員骰子；bidding 期為 null。 */
  reveal: RevealEntry[] | null;
  /** 開盅結果描述（繁中）。 */
  resolve_note: string | null;
}

/** 前端使用的回合快照（camelCase）。 */
export interface GameRound {
  /** 回合編號（1 起算）。 */
  roundNo: number;
  /** 目前要操作的座位。 */
  currentSeat: number;
  /** 目前喊牌數量（尚未喊牌為 null）。 */
  bidCount: number | null;
  /** 目前喊牌點數（尚未喊牌為 null）。 */
  bidFace: number | null;
  /** 目前喊牌者（尚未喊牌為 null）。 */
  bidUser: string | null;
  /** 本回合第幾手（0 表示尚未喊牌）。 */
  bidSeq: number;
  /** 本手截止時間（ISO 字串）。 */
  deadlineAt: string;
  /** 回合狀態。 */
  status: GameRoundStatus;
  /** 開盅後的全員骰子；bidding 期為 null。 */
  reveal: RevealEntry[] | null;
  /** 開盅結果描述（繁中）。 */
  resolveNote: string | null;
}

/** game_player_state 的單列（原始形狀）。 */
export interface PlayerStateRow {
  /** 局 ID。 */
  session_id: number;
  /** 玩家 user_id。 */
  user_id: string;
  /** 座位編號（開局時的快照，1 起算）。 */
  seat: number;
  /** 剩餘骰子數。 */
  dice_left: number;
  /** 是否已淘汰（dice_left 歸零）。 */
  eliminated: boolean;
}

/** 前端使用的玩家局內狀態（camelCase）。 */
export interface PlayerState {
  /** 玩家 user_id。 */
  userId: string;
  /** 座位編號。 */
  seat: number;
  /** 剩餘骰子數。 */
  diceLeft: number;
  /** 是否已淘汰。 */
  eliminated: boolean;
}

/** 前端玩家列：局內狀態加上顯示名稱。 */
export interface PlayerView extends PlayerState {
  /** profiles.display_name；缺值時由 UI 補位。 */
  displayName: string | null;
}
