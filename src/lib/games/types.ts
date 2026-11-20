/**
 * 吹牛骰子遊戲：房間資料型別（Supabase snake_case → 前端 camelCase）。
 */

/** game_rooms 的單列（原始形狀）。 */
export interface GameRoomRow {
  /** 房間 ID（6 碼英數）。 */
  room_id: string;
  /** 房主的使用者 ID。 */
  host_id: string;
  /** 每人骰子數（2-5）。 */
  dice_count: number;
  /** 每回合思考秒數（5-30）。 */
  turn_seconds: number;
  /** 房間狀態。 */
  status: 'waiting' | 'playing' | 'ended' | 'closed';
  /** 最後活動時間（閒置關閉與心跳共用）。 */
  last_activity_at: string;
  /** 建立時間。 */
  created_at: string;
}

/** 前端使用的房間快照（camelCase）。 */
export interface GameRoom {
  /** 房間 ID（6 碼英數）。 */
  roomId: string;
  /** 房主的使用者 ID。 */
  hostId: string;
  /** 每人骰子數（2-5）。 */
  diceCount: number;
  /** 每回合思考秒數（5-30）。 */
  turnSeconds: number;
  /** 房間狀態。 */
  status: 'waiting' | 'playing' | 'ended' | 'closed';
  /** 建立時間。 */
  createdAt: string;
}

/** room_member_list RPC 的單列：房內成員含顯示名稱。 */
export interface RoomMemberRow {
  /** 使用者 ID。 */
  user_id: string;
  /** 座位編號（1 起算）。 */
  seat: number;
  /** 加入時間。 */
  joined_at: string;
  /** 顯示名稱（profiles 可能缺值，為 null 時由前端補位）。 */
  display_name: string | null;
}

/** 前端使用的房內成員快照（camelCase）。 */
export interface RoomPlayer {
  /** 使用者 ID。 */
  userId: string;
  /** 座位編號（1 起算）。 */
  seat: number;
  /** 加入時間。 */
  joinedAt: string;
  /** 顯示名稱；缺值時為 null。 */
  displayName: string | null;
}

/** 把 game_rooms 列對應成前端遊戲快照。 */
export function toGameRoom(row: GameRoomRow): GameRoom {
  return {
    roomId: row.room_id,
    hostId: row.host_id,
    diceCount: row.dice_count,
    turnSeconds: row.turn_seconds,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** 把 room_member_list 列對應成前端成員快照。 */
export function toRoomPlayer(row: RoomMemberRow): RoomPlayer {
  return {
    userId: row.user_id,
    seat: row.seat,
    joinedAt: row.joined_at,
    displayName: row.display_name,
  };
}
