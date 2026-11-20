/**
 * /games/room/:roomId 房間大廳。
 *
 * 單欄手機優先：房間 ID＋複製 → 玩家列表（seat 卡片）→
 * 房主設定摺疊面板 → 開始遊戲（本階段佔位）與離開房間。
 * 房間／成員／連線狀態全部由 useRoomState 的訂閱維護。
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/authStore';
import {
  kickGamePlayer,
  leaveGameRoom,
  updateGameRoomSettings,
  useRoomState,
} from '../../lib/games/roomClient';
import { fetchLatestSessionId, startGame } from '../../lib/games/gameClient';
import type { RoomPlayer } from '../../lib/games/types';
import {
  clampInRange,
  DICE_COUNT_RANGE,
  TURN_SECONDS_RANGE,
} from '../../lib/games/roomValidate';
import { GAMES_LINK_BTN, GamesAuthGate } from './GamesAuthGate';

/** 座位頭像的色票（依 seat 循環套用）。 */
const SEAT_COLORS = [
  'bg-neon-purple/70',
  'bg-neon-cyan/70',
  'bg-neon-pink/70',
  'bg-neon-gold/70',
  'bg-neon-green/70',
  'bg-neon-purple/40',
  'bg-neon-cyan/40',
  'bg-neon-pink/40',
];

/** 設定摺疊面板中單一數值控制項。 */
interface SettingControlProps {
  /** 顯示用標籤（例如「每人骰子數」）。 */
  label: string;
  /** 目前資料庫的值。 */
  value: number;
  /** 最小值（含）。 */
  min: number;
  /** 最大值（含）。 */
  max: number;
  /** 數值後綴單位（例如「顆」「秒」）。 */
  unit: string;
  /** 值確定變更時的回呼（±按鈕立即、滑桿放開時）。 */
  onCommit: (value: number) => void;
}

/**
 * 單一設定控制項：slider 加上 −／＋ 按鈕，數字即時顯示（規劃書 §6.1）。
 *
 * 滑桿拖曳中只改本地草稿，放開（pointerup／keyup）才送出，
 * 避免 RPC 被滑動事件灌爆；±按鈕一次一步並立即送出。
 *
 * @param props 控制項參數
 */
function SettingControl(props: SettingControlProps) {
  const [draft, setDraft] = useState(props.value);

  // 資料庫值更新（例如訂閱同步回來）時追平草稿
  useEffect(() => setDraft(props.value), [props.value]);

  /** 夾在範圍內並送出。 */
  const commit = (value: number) => {
    const next = clampInRange(value, props.min, props.max);
    setDraft(next);
    props.onCommit(next);
  };

  return (
    <div className="mt-4 first:mt-0">
      <p className="text-xs font-semibold text-ink-muted">
        {props.label}：<span className="text-ink">{draft}</span> {props.unit}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          aria-label={`減少${props.label}`}
          onClick={() => commit(draft - 1)}
          disabled={draft <= props.min}
          className="min-h-[44px] min-w-[44px] rounded-full border border-white/15 bg-white/5 text-lg font-bold text-ink disabled:opacity-40"
        >
          −
        </button>
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={1}
          value={draft}
          aria-label={props.label}
          onChange={(event) => setDraft(Number(event.target.value))}
          onPointerUp={() => commit(draft)}
          onKeyUp={() => commit(draft)}
          className="h-11 flex-1 accent-purple-400"
        />
        <button
          type="button"
          aria-label={`增加${props.label}`}
          onClick={() => commit(draft + 1)}
          disabled={draft >= props.max}
          className="min-h-[44px] min-w-[44px] rounded-full border border-white/15 bg-white/5 text-lg font-bold text-ink disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** 房主設定摺疊面板的參數。 */
interface HostSettingsPanelProps {
  /** 房間 ID。 */
  roomId: string;
  /** 目前每人骰子數。 */
  diceCount: number;
  /** 目前思考秒數。 */
  turnSeconds: number;
}

/**
 * 房主設定摺疊面板（僅房主、僅等待中顯示）。
 *
 * @param props 面板參數
 */
function HostSettingsPanel(props: HostSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 送出單一設定（另一項帶 null 維持原值）。 */
  const commit = async (dice: number | null, seconds: number | null) => {
    setError(null);
    try {
      await updateGameRoomSettings(props.roomId, dice, seconds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '設定失敗，請再試一次。');
    }
  };

  return (
    <section className="panel p-4" aria-label="房主設定面板">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[44px] w-full items-center justify-between text-sm font-semibold text-ink"
      >
        遊戲設定（房主）
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <div className="mt-3">
          <SettingControl
            label="每人骰子數"
            unit="顆"
            value={props.diceCount}
            min={DICE_COUNT_RANGE.min}
            max={DICE_COUNT_RANGE.max}
            onCommit={(value) => void commit(value, null)}
          />
          <SettingControl
            label="思考時間"
            unit="秒"
            value={props.turnSeconds}
            min={TURN_SECONDS_RANGE.min}
            max={TURN_SECONDS_RANGE.max}
            onCommit={(value) => void commit(null, value)}
          />
          {error ? <p className="mt-3 text-xs text-neon-pink" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/** 單一玩家卡的參數。 */
interface PlayerCardProps {
  /** 成員資料。 */
  player: RoomPlayer;
  /** 是否為自己。 */
  isSelf: boolean;
  /** 是否為房主（顯示徽章與連線狀態的依據之一）。 */
  isHost: boolean;
  /** 是否可移除（房主在等待中看其他成員）。 */
  canKick: boolean;
  /** 目前連線中的成員名單。 */
  onlineIds: string[];
  /** 按下移除時的回呼。 */
  onKick: (player: RoomPlayer) => void;
}

/**
 * 單一玩家卡：色塊頭像（暱稱首字）、暱稱、房主徽章、連線 dot。
 *
 * @param props 卡片參數
 */
function PlayerCard(props: PlayerCardProps) {
  const firstChar = props.player.displayName?.trim().charAt(0) || props.player.userId.charAt(0);
  const color = SEAT_COLORS[(props.player.seat - 1) % SEAT_COLORS.length];
  const online = props.onlineIds.includes(props.player.userId);
  return (
    <li className="panel flex items-center gap-3 p-3">
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg font-black text-white ${color}`}
      >
        {firstChar}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">
          {props.player.displayName ?? '玩 家'}
          {props.isSelf ? <span className="ml-1 text-xs text-ink-muted">（你）</span> : null}
        </p>
        <p className="text-xs text-ink-muted">
          席位 {props.player.seat}
          {props.isHost ? <span className="ml-2 font-semibold text-neon-gold">房主</span> : null}
        </p>
      </div>
      <span
        className="flex items-center gap-1 text-xs text-ink-muted"
        title={online ? '連線中' : '離線'}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${online ? 'bg-neon-green' : 'bg-white/25'}`}
        />
        {online ? '在線' : '離線'}
      </span>
      {props.canKick ? (
        <button
          type="button"
          onClick={() => props.onKick(props.player)}
          className="min-h-[44px] rounded-full border border-neon-pink/40 px-3 text-xs font-semibold text-neon-pink hover:bg-neon-pink/15"
        >
          移除
        </button>
      ) : null}
    </li>
  );
}

/** 房間 ID 標題列的參數。 */
interface RoomIdHeaderProps {
  /** 房間 ID。 */
  roomId: string;
}

/**
 * 房間 ID 大字與複製按鈕；複製成功顯示「已複製」回饋。
 *
 * @param props 標題列參數
 */
function RoomIdHeader(props: RoomIdHeaderProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 卸載時清掉回饋計時器，避免對已卸載元件 setState
  useEffect(() => () => clearTimeout(timerRef.current), []);

  /** 複製房間 ID 到剪貼簿，成功後顯示兩秒的回饋。 */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.roomId);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="text-center">
      <h1 className="neon-text font-display text-4xl font-black tracking-[0.25em] sm:text-5xl">
        {props.roomId}
      </h1>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="mt-3 min-h-[44px] rounded-full border border-neon-cyan/60 bg-neon-cyan/15 px-5 text-sm font-semibold text-ink transition hover:bg-neon-cyan/30"
      >
        {copied ? '已複製' : '複製房間 ID'}
      </button>
      <p className="mt-2 text-xs text-ink-muted">把房間 ID 分享給朋友，對方由「加入房間」進來</p>
    </div>
  );
}

/** 開始遊戲與離開房間列的參數。 */
interface RoomActionsProps {
  /** 是否為房主。 */
  isHost: boolean;
  /** 目前人數是否足以開始（≥2）。 */
  enoughPlayers: boolean;
  /** 開局中旗標（按鈕禁用）。 */
  starting: boolean;
  /** 按下開始遊戲時的回呼。 */
  onStart: () => void;
  /** 是否為房主（離開時顯示移交提示）。 */
  hostLeavingHint: string;
  /** 離開中的旗標（按鈕禁用）。 */
  leaving: boolean;
  /** 按下離開時的回呼。 */
  onLeave: () => void;
}

/**
 * 開始遊戲（房主專屬；開局後全員導向 play 頁）與離開房間。
 *
 * @param props 操作列參數
 */
function RoomActions(props: RoomActionsProps) {
  return (
    <div className="flex flex-col gap-3">
      {props.isHost ? (
        <div className="text-center">
          <button
            type="button"
            disabled={!props.enoughPlayers || props.starting}
            onClick={props.onStart}
            data-testid="start-game"
            className={
              'w-full rounded-full border border-neon-purple/60 bg-neon-purple/25 px-5 py-3 ' +
              'text-sm font-semibold text-ink transition hover:bg-neon-purple/40 ' +
              'disabled:cursor-not-allowed disabled:opacity-45'
            }
          >
            {props.starting
              ? '開局中……'
              : props.enoughPlayers
                ? '開始遊戲'
                : '開始遊戲（需至少 2 名玩家）'}
          </button>
          <p className="mt-1.5 text-xs text-ink-muted">
            {props.enoughPlayers ? '開局後全員進入主畫面，每人只看得到自己的骰子' : '需至少 2 名玩家才能開始'}
          </p>
        </div>
      ) : (
        <p className="text-center text-sm text-ink-muted">等待房主開始遊戲……</p>
      )}
      <div className="text-center">
        <button
          type="button"
          onClick={props.onLeave}
          disabled={props.leaving}
          className="min-h-[44px] w-full rounded-full border border-neon-pink/40 bg-neon-pink/10 px-5 text-sm font-semibold text-neon-pink transition hover:bg-neon-pink/20 disabled:opacity-50"
        >
          {props.leaving ? '離開中……' : '離開房間'}
        </button>
        {props.hostLeavingHint ? (
          <p className="mt-1.5 text-xs text-ink-muted">{props.hostLeavingHint}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 房間大廳頁面本體（已通過登入守門）。
 */
function RoomDetail() {
  const { roomId: rawRoomId } = useParams();
  const roomId = (rawRoomId ?? '').toUpperCase();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { room, players, onlineIds, loading, error } = useRoomState(roomId);
  const [leaving, setLeaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** 開始遊戲：成功後導向本局主畫面（其餘成員由訂閱同步自行導向）。 */
  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    setActionError(null);
    try {
      const sessionId = await startGame(roomId);
      navigate(`/games/play/${sessionId}`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '開始遊戲失敗，請再試一次。');
      setStarting(false);
    }
  };

  /** 離開房間：成功後回遊戲首頁（房主離開由 SQL 移交房主或關房）。 */
  const handleLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    setActionError(null);
    try {
      await leaveGameRoom(roomId);
      navigate('/games');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '離開房間失敗，請再試一次。');
      setLeaving(false);
    }
  };

  /** 房主移除玩家；二次確認避免誤觸。 */
  const handleKick = async (player: RoomPlayer) => {
    if (!window.confirm(`確定移除「${player.displayName ?? '這位玩家'}」？`)) return;
    setActionError(null);
    try {
      await kickGamePlayer(roomId, player.userId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '移除玩家失敗。');
    }
  };

  // 遊戲已開局（房主按鈕或他人視角的訂閱同步）：全員導向本局主畫面
  const roomStatus = room?.status ?? null;
  useEffect(() => {
    if (roomStatus !== 'playing') return;
    let cancelled = false;
    void fetchLatestSessionId(roomId).then((sessionId) => {
      if (!cancelled && sessionId) {
        navigate(`/games/play/${sessionId}`, { replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [roomStatus, roomId, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 text-center">
        <p className="text-sm text-ink-muted">房間載入中，請稍候……</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="font-display text-xl font-bold text-ink">房間連線出現問題</p>
        <p className="text-sm text-ink-muted">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={GAMES_LINK_BTN}
        >
          重新載入
        </button>
      </div>
    );
  }
  if (!room) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="font-display text-xl font-bold text-ink">房間不存在或已關閉</p>
        <Link to="/games" className={GAMES_LINK_BTN}>
          回到遊戲首頁
        </Link>
      </div>
    );
  }

  const isHost = room.hostId === user?.id;
  const waiting = room.status === 'waiting';

  return (
    <div className="pb-36 pt-8 sm:pb-24">
      <div className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 sm:px-6">
        <RoomIdHeader roomId={room.roomId} />
        {room.status !== 'waiting' ? (
          <p className="panel p-3 text-center text-sm text-ink-muted">
            {room.status === 'closed'
              ? '房間已關閉，成員無法再進入。'
              : room.status === 'playing'
                ? '遊戲進行中。'
                : '這局遊戲已結束。'}
          </p>
        ) : null}

        <section aria-label="玩家列表">
          <p className="mb-2 text-sm font-semibold text-ink">
            玩家（{players.length}/8）・每人 {room.diceCount} 顆骰子・思考 {room.turnSeconds} 秒
          </p>
          <ul className="flex flex-col gap-2">
            {players.map((player) => (
              <PlayerCard
                key={player.userId}
                player={player}
                isSelf={player.userId === user?.id}
                isHost={player.userId === room.hostId}
                canKick={isHost && waiting && player.userId !== user?.id}
                onlineIds={onlineIds}
                onKick={(target) => void handleKick(target)}
              />
            ))}
          </ul>
        </section>

        {isHost && waiting ? (
          <HostSettingsPanel
            roomId={room.roomId}
            diceCount={room.diceCount}
            turnSeconds={room.turnSeconds}
          />
        ) : null}

        {actionError ? <p className="text-xs text-neon-pink" role="alert">{actionError}</p> : null}
        <RoomActions
          isHost={isHost}
          enoughPlayers={players.length >= 2}
          starting={starting}
          onStart={() => void handleStart()}
          hostLeavingHint={
            isHost ? '離開後房主將移交給席位最早的成員；房內無人時房間自動關閉。' : ''
          }
          leaving={leaving}
          onLeave={() => void handleLeave()}
        />
      </div>
    </div>
  );
}

/**
 * /games/room/:roomId 房間大廳。
 */
export function GameRoomPage() {
  return (
    <GamesAuthGate>
      <RoomDetail />
    </GamesAuthGate>
  );
}
