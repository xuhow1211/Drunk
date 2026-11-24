/**
 * 遊戲核心的 Supabase 操作層（RPC 包裝與局況即時訂閱）。
 *
 * 職責：
 *   1. 包裝 supabase/game-core.sql 的 RPC（start_game／submit_bid／
 *      challenge_bid／sync_timeout），繁中錯誤直接上拋。
 *   2. useGameState(sessionId)：以 postgres_changes 訂閱 game_sessions、
 *      game_rounds、game_player_state 與 game_player_dice（後者依 RLS
 *      只會收到本人那列），輪次與骰子狀態全部由訂閱維護。
 *   3. fetchLatestSessionId(roomId)：大廳在房間轉 playing 後找出本局，
 *      導向 /games/play/:sessionId。
 *
 * supabase-js 依專案慣例以動態匯入載入，不進入主 bundle。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useAuth } from '../authStore';
import { fetchRoomPlayers } from './roomClient';
import type {
  GameSession,
  GameSessionRow,
  GameRound,
  GameRoundRow,
  PlayerState,
  PlayerStateRow,
  PlayerView,
  PlayerStatsRow,
  PlayerStats,
  GameEvent,
  GameEventRow,
} from './gameTypes';

/** 事件紀錄的顯示上限（最新在上；超量截斷）。 */
export const GAME_LOG_LIMIT = 30;

/** 取得 Supabase 用戶端（未配置時拋出可顯示的錯誤）。 */
async function loadClient(): Promise<SupabaseClient> {
  const { getSupabaseClient } = await import('../supabase');
  const client = getSupabaseClient();
  if (!client) throw new Error('遊戲功能尚未啟用，請確認 Supabase 設定。');
  return client;
}

/** 把例外轉成可直接顯示的繁中訊息。 */
function describeError(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

/** RPC 呼叫的最小結果形狀（未建生成型別，僅取 error 與 data）。 */
interface RawRpcResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/**
 * 執行無回傳值的 RPC；失敗時把 Postgres 繁中訊息轉成 Error 拋出。
 *
 * @param client Supabase 用戶端
 * @param name RPC 名稱（如 'submit_bid'）
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

/** 開始遊戲（房主專屬）：回傳新建的 session id（路由 /games/play/:id 用）。 */
export async function startGame(roomId: string): Promise<number> {
  const client = await loadClient();
  const { data, error } = (await client.rpc('start_game', {
    p_room_id: roomId,
  })) as RawRpcResult<number>;
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/** 喊牌（當前玩家）。 */
export async function submitBid(sessionId: number, count: number, face: number): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'submit_bid', {
    p_session_id: sessionId,
    p_count: count,
    p_face: face,
  });
}

/** 質疑上一筆喊牌（當前玩家；首喊不可質疑）。 */
export async function challengeBid(sessionId: number): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'challenge_bid', { p_session_id: sessionId });
}

/** 逾時同步：倒數歸零後由任一成員呼叫，SQL 端冪等處裡（代喊或代質疑；
 *  await_ack 逾時上限已過時全員代為確認並轉入喊牌）。 */
export async function syncTimeout(sessionId: number): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'sync_timeout', { p_session_id: sessionId });
}

/** 確認看過開盅結果（本局成員；全員確認後 SQL 端自動轉入喊牌並開始倒數，
 *  冪等：重複呼叫或回合已轉入喊牌時為無操作）。 */
export async function ackReveal(sessionId: number): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'ack_reveal', { p_session_id: sessionId });
}

/** 房主重開房間（clear 既有局況、狀態轉回 waiting、成員保留；冪等）。 */
export async function replayGameRoom(roomId: string): Promise<void> {
  const client = await loadClient();
  await callRpc(client, 'replay_room', { p_room_id: roomId });
}

/** 讀取單一局況快照（不存在時為 null）。 */
export async function fetchGameSession(sessionId: number): Promise<GameSession | null> {
  const client = await loadClient();
  const { data } = await client
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  return data ? toGameSession(data as GameSessionRow) : null;
}

/** 讀取某局最新一筆回合快照（尚無回合時為 null）。 */
export async function fetchLatestRound(sessionId: number): Promise<GameRound | null> {
  const client = await loadClient();
  const { data } = await client
    .from('game_rounds')
    .select('*')
    .eq('session_id', sessionId)
    .order('round_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toGameRound(data as GameRoundRow) : null;
}

/** 讀取某局全部玩家狀態（依 seat 排序）。 */
export async function fetchPlayerStates(sessionId: number): Promise<PlayerState[]> {
  const client = await loadClient();
  const { data } = await client
    .from('game_player_state')
    .select('*')
    .eq('session_id', sessionId)
    .order('seat', { ascending: true });
  return ((data ?? []) as PlayerStateRow[]).map(toPlayerState);
}

/** 讀取自己各回合的骰子（RLS 僅本人可見）：以 round_no 為鍵。 */
export async function fetchMyDice(sessionId: number): Promise<Record<number, number[]>> {
  const client = await loadClient();
  const { data } = await client
    .from('game_player_dice')
    .select('round_no, dice')
    .eq('session_id', sessionId);
  const map: Record<number, number[]> = {};
  for (const row of (data ?? []) as Array<{ round_no: number; dice: number[] }>) {
    map[row.round_no] = row.dice;
  }
  return map;
}

/** 讀取某房間的最新一局 ID（尚無遊戲時為 null；大廳導向 play 頁時用）。 */
export async function fetchLatestSessionId(roomId: string): Promise<number | null> {
  const client = await loadClient();
  const { data } = await client
    .from('game_sessions')
    .select('id')
    .eq('room_id', roomId.toUpperCase())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (data as { id: number }).id : null;
}

/** 讀取某局的操作事件（game_actions；最新在前），供事件紀錄區顯示。 */
export async function fetchGameEvents(
  sessionId: number,
  limit: number = GAME_LOG_LIMIT,
): Promise<GameEvent[]> {
  const client = await loadClient();
  const { data } = await client
    .from('game_actions')
    .select('*')
    .eq('session_id', sessionId)
    .order('seq', { ascending: false })
    .limit(limit);
  return ((data ?? []) as GameEventRow[]).map((row) => ({
    seq: row.seq,
    roundNo: row.round_no,
    userId: row.user_id,
    action: row.action,
    count: row.count,
    face: row.face,
    createdAt: row.created_at,
  }));
}

/** 讀取玩家的個人戰績（player_statistics；尚無紀錄時為 null）。 */
export async function fetchPlayerStats(userId: string): Promise<PlayerStats | null> {
  const client = await loadClient();
  const { data } = await client
    .from('player_statistics')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const row = data as PlayerStatsRow;
  return {
    games: row.games,
    wins: row.wins,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
  };
}

/** 事件紀錄的顯示條目（已組好繁中描述與時間）。 */
export interface GameLogEntry {
  /** 穩定的 React key。 */
  key: string;
  /** 繁中描述（喊牌／質疑／逾時代打／淘汰）。 */
  text: string;
  /** 事件時間（ISO 字串或本機補上的當下時間）。 */
  at: string;
}

/**
 * 遊戲事件紀錄 hook（規劃書 §9.2 第六區的資料來源，自擇最簡者）：
 * 操作事件直接讀 game_actions（公開表；在回合推進時重抓一次），
 * 淘汰事件由玩家狀態訂閱累計（首次載入時已淘汰者不重複記錄，
 * 比同一 player_id 只記一次）。最新在前、上限 GAME_LOG_LIMIT 筆。
 *
 * @param sessionId 局 ID
 * @param players 玩家列（含顯示名稱；僅供描述使用，值不觸發重抓）
 * @param roundNo 目前回合編號（回合推進時重抓操作事件）
 * @param bidSeq 本回合手數（新的一手也重抓，逾時代打才看得到）
 * @returns 顯示條目列表（最新在前，最多 GAME_LOG_LIMIT 筆）
 */
export function useGameLog(
  sessionId: number,
  players: PlayerView[],
  roundNo: number | undefined,
  bidSeq: number | undefined,
): GameLogEntry[] {
  const [rows, setRows] = useState<GameEvent[]>([]);
  const [eliminated, setEliminated] = useState<Array<{ userId: string; at: string }>>([]);
  const knownEliminatedRef = useRef<Set<string>>(new Set());

  // 回合或手數推進時重抓操作事件（失敗靜默：紀錄區非關鍵路徑）
  useEffect(() => {
    if (!(sessionId > 0)) return;
    let cancelled = false;
    void fetchGameEvents(sessionId, GAME_LOG_LIMIT)
      .then((events) => {
        if (!cancelled) setRows(events);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, roundNo, bidSeq]);

  // 淘汰累計：新出現的淘汰玩家記一筆（含首次載入時即已淘汰者）
  useEffect(() => {
    const fresh = players.filter(
      (p) => p.eliminated && !knownEliminatedRef.current.has(p.userId),
    );
    if (fresh.length === 0) return;
    for (const p of fresh) knownEliminatedRef.current.add(p.userId);
    const now = new Date().toISOString();
    setEliminated((prev) => [...prev, ...fresh.map((p) => ({ userId: p.userId, at: now }))]);
  }, [players]);

  // 顯示條目：操作事件＋淘汰事件合併、依時間最新在前、截至上限
  return useMemo(() => {
    const nameOf = (userId: string) =>
      players.find((p) => p.userId === userId)?.displayName ?? '玩家';
    const entries: GameLogEntry[] = rows.map((row) => ({
      key: `a${row.seq}`,
      at: row.createdAt,
      text:
        row.action === 'bid'
          ? `${nameOf(row.userId)} 喊了 ${row.count} 個 ${row.face} 點`
          : row.action === 'challenge'
            ? `${nameOf(row.userId)} 質疑，進行開盅`
            : row.action === 'timeout_bid'
              ? `${nameOf(row.userId)} 逾時，系統代喊 1 個 1 點`
              : `${nameOf(row.userId)} 逾時，系統代為質疑`,
    }));
    for (const item of eliminated) {
      entries.push({ key: `e${item.userId}`, at: item.at, text: `${nameOf(item.userId)} 已被淘汰` });
    }
    entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return entries.slice(0, GAME_LOG_LIMIT);
  }, [rows, eliminated, players]);
}

/** 把 game_sessions 列對應成前端局況快照。 */

/** 局況 hook 的回傳（session／round／players／dice 全部由訂閱維護）。 */
export interface GameState {
  /** 當前局況快照（含勝者欄位）。 */
  session: GameSession | null;
  /** 當前最新回合（bidding／await_ack／round_end／ended）。 */
  round: GameRound | null;
  /** 玩家局內狀態＋顯示名稱（依 seat 排序）。 */
  players: PlayerView[];
  /** 自己當前回合的骰子（尚無資料時為 null）。 */
  dice: number[] | null;
  /** 初始載入中。 */
  loading: boolean;
  /** 載入或訂閱錯誤（可直接顯示的繁中訊息）。 */
  error: string | null;
}

/**
 * 局況同步 hook：登入狀態變動時重綁；成員事件後以 room_member_list
 * 補齊 display_name（profiles 的 RLS 只放行本人，故走 security definer）。
 *
 * @param sessionId 局 ID（路由參數）
 * @param onReveal 收到帶 reveal 的回合事件時直接上拋（開盅顯示用；見
 *   bindGameChannel 的說明——不能只依賴渲染出的回合狀態）
 * @returns 局況快照、最新回合、玩家列與自己的骰子
 */
export function useGameState(
  sessionId: number,
  onReveal?: (round: GameRound) => void,
): GameState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [session, setSession] = useState<GameSession | null>(null);
  const [round, setRound] = useState<GameRound | null>(null);
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [diceByRound, setDiceByRound] = useState<Record<number, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let dispose: () => void = () => {};
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const client = await loadClient();
        if (cancelled) return;
        const [nextSession, nextRound, nextStates, nextDice] = await Promise.all([
          fetchGameSession(sessionId),
          fetchLatestRound(sessionId),
          fetchPlayerStates(sessionId),
          fetchMyDice(sessionId),
        ]);
        if (cancelled) return;
        setSession(nextSession);
        setRound(nextRound);
        // 顯示名稱：以房間成員清單（security definer 供名）對映
        const names = new Map<string, string | null>();
        if (nextSession) {
          const members = await fetchRoomPlayers(nextSession.roomId);
          for (const member of members) {
            names.set(member.userId, member.displayName);
          }
        }
        setPlayers(nextStates.map((st) => ({ ...st, displayName: names.get(st.userId) ?? null })));
        setDiceByRound(nextDice);
        dispose = bindGameChannel(
          client,
          sessionId,
          setSession,
          setRound,
          setPlayers,
          setDiceByRound,
          onReveal,
        );
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
    // onReveal 由呼叫端以穩定包裝（ref）維護，不列入依賴以免重綁訂閱
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, userId]);

  const dice = round ? diceByRound[round.roundNo] ?? null : null;
  return { session, round, players, dice, loading, error };
}

/** 把 postgres_changes 事件的新列套用到玩家狀態列（以 seat 排序、名字保留）。 */
function applyPlayerChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  setPlayers: (updater: (prev: PlayerView[]) => PlayerView[]) => void,
): void {
  if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;
  const row = payload.new as unknown as PlayerStateRow | null;
  if (!row) return;
  setPlayers((prev) => {
    const next = prev.filter((p) => p.userId !== row.user_id);
    const oldName = prev.find((p) => p.userId === row.user_id)?.displayName ?? null;
    next.push({ ...toPlayerState(row), displayName: oldName });
    next.sort((a, b) => a.seat - b.seat);
    return next;
  });
}

/** 骰子列事件：把本人的骰子記入該回合（INSERT；UPDATE 防禦性支援）。 */
function applyDiceChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  setDice: (updater: (prev: Record<number, number[]>) => Record<number, number[]>) => void,
): void {
  if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;
  const row = payload.new as unknown as { round_no: number; dice: number[] } | null;
  if (!row) return;
  setDice((prev) => ({ ...prev, [row.round_no]: row.dice }));
}

/** 回合事件：以 round_no 取捨（過期事件丟棄，保留最新）。 */
function applyRoundChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  setRound: (updater: (prev: GameRound | null) => GameRound | null) => void,
): void {
  if (payload.eventType === 'DELETE') return;
  const row = payload.new as unknown as GameRoundRow | null;
  if (!row) return;
  setRound((prev) => {
    if (prev && row.round_no < prev.roundNo) return prev;
    return toGameRound(row);
  });
}

/**
 * 連結局況訂閱（postgres_changes）：公開狀態三表＋僅本人看得到的骰子表
 * （realtime 端依 RLS 過濾，其他人的骰子事件不會送到本端）。
 *
 * 開盅事件不能只依賴「渲染出的回合狀態」：challenge_bid 在同一交易內
 * 送出 round_end（帶 reveal）與下一回合兩類事件，兩者相隔數毫秒，
 * React 的批次更新可能跳過中間的 round_end 狀態（直接渲染到下一回合），
 * 因此帶 reveal 的列須在事件回呼直接上拋（onReveal），不經渲染。
 *
 * @returns 解除訂閱用的清理函式
 */
function bindGameChannel(
  client: SupabaseClient,
  sessionId: number,
  setSession: (value: GameSession | null) => void,
  setRound: (updater: (prev: GameRound | null) => GameRound | null) => void,
  setPlayers: (updater: (prev: PlayerView[]) => PlayerView[]) => void,
  setDice: (updater: (prev: Record<number, number[]>) => Record<number, number[]>) => void,
  onReveal?: (round: GameRound) => void,
): () => void {
  const onDice = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
    applyDiceChange(payload, setDice);
  };
  const onRound = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
    applyRoundChange(payload, setRound);
    // 開盅列直接上拋：批次更新跳過中間渲染時仍能顯示開盅面板
    const row = payload.new as unknown as GameRoundRow | null;
    if (row?.reveal && onReveal) onReveal(toGameRound(row));
  };
  const onPlayers = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
    applyPlayerChange(payload, setPlayers);
  };
  const channel = client
    .channel('game-state:' + sessionId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') return;
        const row = payload.new as unknown as GameSessionRow | null;
        if (row) setSession(toGameSession(row));
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_rounds', filter: `session_id=eq.${sessionId}` },
      onRound,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'game_player_state',
        filter: `session_id=eq.${sessionId}`,
      },
      onPlayers,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'game_player_dice',
        filter: `session_id=eq.${sessionId}`,
      },
      onDice,
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/** 把 game_sessions 列對應成前端局況快照。 */
export function toGameSession(row: GameSessionRow): GameSession {
  return {
    sessionId: row.id,
    roomId: row.room_id,
    diceCount: row.dice_count,
    turnSeconds: row.turn_seconds,
    startedAt: row.started_at,
    winner: row.winner,
    endedAt: row.ended_at,
  };
}

/** 把 game_rounds 列對應成前端回合快照。 */
export function toGameRound(row: GameRoundRow): GameRound {
  return {
    roundNo: row.round_no,
    currentSeat: row.current_seat,
    bidCount: row.bid_count,
    bidFace: row.bid_face,
    bidUser: row.bid_user,
    bidSeq: row.bid_seq,
    deadlineAt: row.deadline_at,
    status: row.status,
    reveal: row.reveal,
    resolveNote: row.resolve_note,
  };
}

/** 把 game_player_state 列對應成前端玩家狀態。 */
export function toPlayerState(row: PlayerStateRow): PlayerState {
  return {
    userId: row.user_id,
    seat: row.seat,
    diceLeft: row.dice_left,
    eliminated: row.eliminated,
    ackRoundNo: row.ack_round_no,
  };
}
