/**
 * 房間系統的 Supabase 操作層（RPC 包裝、即時訂閱與 presence）。
 *
 * 職責：
 *   1. 包裝 supabase/game-rooms.sql 的 RPC，錯誤訊息（簡短繁中）直接上拋。
 *   2. useRoomState(roomId)：以 postgres_changes 訂閱 game_rooms／
 *      game_room_players（filtered by room_id），presence 頻道提供連線名單，
 *      並定時呼叫 heartbeat_room 維護 last_activity_at。
 *
 * supabase-js 依專案慣例以動態匯入載入，不進入主 bundle。
 */
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { toGameRoom, toRoomPlayer } from './types';
import type { GameRoom, GameRoomRow, RoomPlayer, RoomMemberRow } from './types';
import { useAuth } from '../authStore';

/** 房間狀態 hook 的回傳（room／players／onlineIds 全部由訂閱維護）。 */
export interface RoomState {
  /** 房間目前快照；房間已關閉（closed）時仍會帶著最後狀態。 */
  room: GameRoom | null;
  /** 房內成員（依 seat 排序）。 */
  players: RoomPlayer[];
  /** 目前連線中的成員 user_id 名單（presence）。 */
  onlineIds: string[];
  /** 初始載入中。 */
  loading: boolean;
  /** 載入或訂閱錯誤（可直接顯示的繁中訊息）。 */
  error: string | null;
  /** 立即重抓房間快照（RPC 成功後的本地回聲，不等 Realtime 事件）。 */
  refreshRoom: () => Promise<void>;
}

/** 訂閱回呼共用介面：狀態更新一律回寫到 hook 的 state。 */
interface RoomSyncHandlers {
  onRoom: (room: GameRoom | null) => void;
  onPlayers: (players: RoomPlayer[]) => void;
  onOnline: (ids: string[]) => void;
  onError: (message: string | null) => void;
}

/** heartbeat 的間隔（毫秒）：last_activity_at 與 presence 心跳共用欄位。 */
const HEARTBEAT_MS = 30_000;

/** 把例外轉成可直接顯示的繁中訊息。 */
function describeError(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

/** 取得 Supabase 用戶端（未配置時拋出可顯示的錯誤）。 */
async function loadClient(): Promise<SupabaseClient> {
  const { getSupabaseClient } = await import('../supabase');
  const client = getSupabaseClient();
  if (!client) throw new Error('遊戲功能尚未啟用，請確認 Supabase 設定。');
  return client;
}

/** RPC 呼叫的最小結果形狀（未建生成型別，僅取 error 與 data）。 */
interface RawRpcResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/**
 * 以動態名稱執行 RPC（未配置生成型別時 supabase-js 的 rpc 不接受動態名稱，
 * 因此對函式簽名做最小化的斷言）；失敗時把 Postgres 繁中訊息轉成 Error 拋出。
 *
 * @param client Supabase 用戶端
 * @param name RPC 名稱（如 'join_room'）
 * @param args RPC 參數
 */
async function callRpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const { error } = (await client.rpc(name, args)) as RawRpcResult<unknown>;
  if (error) throw new Error(error.message);
}

/** 讀取單一房間快照。 */
export async function fetchRoom(roomId: string): Promise<GameRoom | null> {
  const client = await loadClient();
  const { data } = await client
    .from('game_rooms')
    .select('*')
    .eq('room_id', roomId.toUpperCase())
    .maybeSingle();
  return data ? toGameRoom(data as GameRoomRow) : null;
}

/** 讀取房內成員清單（security definer 的 room_member_list，含顯示名稱）。 */
export async function fetchRoomPlayers(roomId: string): Promise<RoomPlayer[]> {
  const client = await loadClient();
  const { data } = (await client.rpc('room_member_list', {
    p_room_id: roomId,
  })) as RawRpcResult<RoomMemberRow[]>;
  return (data ?? []).map(toRoomPlayer);
}

/** 建立房間：回傳 6 碼房間 ID。 */
export async function createGameRoom(diceCount: number, turnSeconds: number): Promise<string> {
  const client = await loadClient();
  const { data, error } = (await client.rpc('create_room', {
    p_dice_count: diceCount,
    p_turn_seconds: turnSeconds,
  })) as RawRpcResult<string>;
  if (error) throw new Error(error.message);
  return data ?? '';
}

/** 加入房間（冪等：已在房內時僅刷新活動時間）。 */
export async function joinGameRoom(roomId: string): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'join_room', { p_room_id: roomId });
}

/** 離開房間（房主離開會移交房主；無人則關房）。 */
export async function leaveGameRoom(roomId: string): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'leave_room', { p_room_id: roomId });
}

/** 更新房間設定（僅房主、僅等待中；null 的項目維持原值）。 */
export async function updateGameRoomSettings(
  roomId: string,
  diceCount: number | null,
  turnSeconds: number | null,
): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'update_room_settings', {
    p_room_id: roomId,
    p_dice_count: diceCount,
    p_turn_seconds: turnSeconds,
  });
}

/** 關閉房間（僅房主；等待中或遊戲中均可）。 */
export async function closeGameRoom(roomId: string): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'close_room', { p_room_id: roomId });
}

/** 移除玩家（僅房主、僅等待中）。 */
export async function kickGamePlayer(roomId: string, userId: string): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'kick_player', { p_room_id: roomId, p_user_id: userId });
}

/** game_rooms 列變更落到房間快照。DELETE 事件的 new 為空物件：維持最後快照。 */
function applyRoomChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  handlers: RoomSyncHandlers,
): void {
  if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;
  const next = payload.new as unknown as GameRoomRow | null;
  handlers.onRoom(next ? toGameRoom(next) : null);
}

/** 初始或成員變動後重抓成員清單；失敗只標錯誤，不中止訂閱。 */
async function refreshPlayers(roomId: string, handlers: RoomSyncHandlers): Promise<void> {
  try {
    handlers.onPlayers(await fetchRoomPlayers(roomId));
  } catch (cause) {
    handlers.onError(describeError(cause, '成員名單同步失敗。'));
  }
}

/** 心跳：已是成員時刷新 last_activity_at；失敗靜默（下個週期再試）。 */
async function refreshHeartbeat(roomId: string): Promise<void> {
  try {
    const client = await loadClient();
    await callRpc(client, 'heartbeat_room', { p_room_id: roomId });
  } catch {
    // 心跳失敗不打斷前端；閒置判定由資料端 last_activity_at 為準
  }
}

/**
 * 連結兩條即時頻道與心跳：postgres_changes（資料）＋ presence（連線名單）。
 *
 * @returns 解除訂閱用的清理函式
 */
function bindRoomChannels(
  client: SupabaseClient,
  roomId: string,
  userId: string,
  handlers: RoomSyncHandlers,
): () => void {
  const dataChannel = client
    .channel('room-data:' + roomId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_rooms', filter: `room_id=eq.${roomId}` },
      (payload) => applyRoomChange(payload, handlers),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_room_players', filter: `room_id=eq.${roomId}` },
      () => {
        void refreshPlayers(roomId, handlers);
      },
    )
    .subscribe();
  const presenceChannel = client
    .channel('room:' + roomId, { config: { presence: { key: userId } } })
    .on('presence', { event: 'sync' }, () => {
      handlers.onOnline(Object.keys(presenceChannel.presenceState()));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void presenceChannel.track({ online_at: new Date().toISOString() });
      }
    });
  const timer = setInterval(() => {
    void refreshHeartbeat(roomId);
  }, HEARTBEAT_MS);
  return () => {
    clearInterval(timer);
    void client.removeChannel(dataChannel);
    void client.removeChannel(presenceChannel);
  };
}

/**
 * 房間狀態的同步 hook：登入狀態變動時重綁（presence key 須為 userId）。
 *
 * @param roomId 房間 ID（6 碼英數，大小寫皆可）
 * @returns 目前房間／成員／連線名單與載入狀態
 */
export function useRoomState(roomId: string): RoomState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let dispose: () => void = () => {};
    const handlers: RoomSyncHandlers = {
      onRoom: setRoom,
      onPlayers: setPlayers,
      onOnline: setOnlineIds,
      onError: setError,
    };
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const client = await loadClient();
        if (cancelled) return;
        dispose = bindRoomChannels(client, roomId.toUpperCase(), userId ?? '', handlers);

        // 初始快照：房間與成員各抓一次，後續由訂閱維護
        const [nextRoom, nextPlayers] = await Promise.all([
          fetchRoom(roomId),
          fetchRoomPlayers(roomId),
        ]);
        if (cancelled) return;
        setRoom(nextRoom);
        setPlayers(nextPlayers);
        setLoading(false);
      } catch (cause) {
        if (cancelled) return;
        setError(describeError(cause, '遊戲連線失敗，請重新整理。'));
        setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [roomId, userId]);

  const refreshRoom = useCallback(async (): Promise<void> => {
    setRoom(await fetchRoom(roomId));
  }, [roomId]);

  return { room, players, onlineIds, loading, error, refreshRoom };
}

