/**
 * /games/play/:sessionId 遊戲主畫面（六大區、手機優先單欄）。
 *
 * 頂列（房 ID／第 N 輪／離開）→ 玩家狀態列 → 目前喊牌＋倒數 →
 * 我的骰子（大型 SVG 骰面）→ 操作區（加碼與質疑）→
 * 開盅顯示（reveal 短暫覆蓋）→ 遊戲結束的結算卡。
 *
 * 局況全部由 useGameState（postgres_changes 訂閱）維護；倒數以後端
 * deadline_at 與本機時間差計算（回到前景即重算），歸零時呼叫一次
 * sync_timeout（以回合＋手數為鍵節流，防重複呼叫）。
 * 視覺細節（骰面樣式、動畫）留待 Phase 4 精緻化。
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/authStore';
import {
  challengeBid,
  submitBid,
  syncTimeout,
  useGameState,
} from '../../lib/games/gameClient';
import type { GameRound, PlayerView, RevealEntry } from '../../lib/games/gameTypes';
import { BID_FACE_RANGE, isValidBid } from '../../lib/games/bidRules';
import { GAMES_LINK_BTN, GamesAuthGate } from './GamesAuthGate';

/** 開盅顯示的停留毫秒數（之後自動切回新回合視圖）。 */
const REVEAL_SHOW_MS = 6000;

/** 倒數警示門檻（秒）：剩餘 ≤ 5 秒改為警示色。 */
const COUNTDOWN_WARN_SECONDS = 5;

/** 骰面點位的座標（viewBox 0 0 100 100；1～6 點的格點分布）。 */
const DICE_DOT_LAYOUT: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [27, 27],
    [73, 73],
  ],
  3: [
    [27, 27],
    [50, 50],
    [73, 73],
  ],
  4: [
    [27, 27],
    [73, 27],
    [27, 73],
    [73, 73],
  ],
  5: [
    [27, 27],
    [73, 27],
    [50, 50],
    [27, 73],
    [73, 73],
  ],
  6: [
    [27, 24],
    [73, 24],
    [27, 50],
    [73, 50],
    [27, 76],
    [73, 76],
  ],
};

/** 大型 SVG 骰面參數。 */
interface DiceFaceProps {
  /** 骰子點數（1～6）。 */
  value: number;
  /** 顯示尺寸（px）。 */
  size?: number;
}

/**
 * 大型 SVG 骰面：圓角方底＋點數格點（內嵌 SVG，無外部素材）。
 *
 * @param props 骰面參數
 */
function DiceFace(props: DiceFaceProps) {
  const size = props.size ?? 56;
  const dots: Array<[number, number]> =
    DICE_DOT_LAYOUT[props.value] ?? DICE_DOT_LAYOUT[1] ?? [];
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={`${props.value} 點`}
      className="shrink-0"
    >
      <rect x="4" y="4" width="92" height="92" rx="18" fill="#f5f2ff" stroke="#8b7bd8" strokeWidth="4" />
      {dots.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9.5" fill="#3a2d63" />
      ))}
    </svg>
  );
}

/** 小型骰面列（開盅顯示用）。 */
function MiniDiceRow(props: { dice: number[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {props.dice.map((value, index) => (
        <DiceFace key={index} value={value} size={26} />
      ))}
    </div>
  );
}

/** 頂列參數。 */
interface PlayTopBarProps {
  /** 房間 ID。 */
  roomId: string;
  /** 回合編號。 */
  roundNo: number;
}

/**
 * 頂列：房 ID、第 N 輪、離開（回大廳）。
 *
 * @param props 頂列參數
 */
function PlayTopBar(props: PlayTopBarProps) {
  return (
    <header className="flex items-center justify-between gap-2">
      <div>
        <p className="font-display text-2xl font-black tracking-[0.2em] text-ink">{props.roomId}</p>
        <p className="text-xs text-ink-muted">第 {props.roundNo} 輪</p>
      </div>
      <Link
        to={`/games/room/${props.roomId}`}
        className="min-h-[44px] rounded-full border border-neon-pink/40 bg-neon-pink/10 px-4 py-2 text-sm font-semibold text-neon-pink transition hover:bg-neon-pink/20 no-underline"
      >
        離開
      </Link>
    </header>
  );
}

/** 玩家狀態列參數。 */
interface PlayerStripProps {
  /** 玩家列（局內狀態＋顯示名稱）。 */
  players: PlayerView[];
  /** 目前要操作的座位。 */
  currentSeat: number;
  /** 自己的 user_id（高亮判斷）。 */
  selfId: string | null;
}

/**
 * 玩家狀態列：名稱、骰數、當前高亮；淘汰者灰階加「已淘汰」。
 *
 * @param props 玩家狀態列參數
 */
function PlayerStrip(props: PlayerStripProps) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="玩家狀態列">
      {props.players.map((player) => {
        const isCurrent = player.seat === props.currentSeat && !player.eliminated;
        return (
          <li
            key={player.userId}
            className={`panel flex items-center gap-3 px-3 py-2 ${
              player.eliminated ? 'opacity-50 grayscale' : ''
            } ${isCurrent ? 'ring-2 ring-neon-cyan/70' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {player.displayName ?? '玩 家'}
                {player.userId === props.selfId ? (
                  <span className="ml-1 text-xs text-ink-muted">（你）</span>
                ) : null}
              </p>
              <p className="text-xs text-ink-muted">席位 {player.seat}</p>
            </div>
            {player.eliminated ? (
              <span className="text-xs font-semibold text-ink-muted">已淘汰</span>
            ) : (
              <span className="text-xs font-semibold text-neon-gold">骰 ×{player.diceLeft}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 喊牌與倒數行的參數。 */
interface BidStatusRowProps {
  /** 目前回合（含喊牌與 deadline）。 */
  round: GameRound;
  /** 玩家列（喊牌者名稱查閱）。 */
  players: PlayerView[];
  /** 現在時刻（毫秒；由上層的倒數節拍驅動重算）。 */
  nowMs: number;
  /** 大廳總時間（秒；進度條分母）。 */
  turnSeconds: number;
}

/**
 * 目前喊牌行：bid_seq=0 顯示「尚未喊牌」；大字倒數（本機時間差），
 * 剩 5 秒內加警示色；附帶淺色進度條（不以色彩作唯一提示，另有數字）。
 *
 * @param props 行參數
 */
function BidStatusRow(props: BidStatusRowProps) {
  const { round, players } = props;
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(round.deadlineAt) - props.nowMs) / 1000));
  const warn = secondsLeft <= COUNTDOWN_WARN_SECONDS && round.status === 'bidding';
  const bidder = players.find((p) => p.userId === round.bidUser);
  const bidderName = bidder?.displayName ?? '玩家';
  const ratio = round.status === 'bidding'
    ? Math.min(1, Math.max(0, secondsLeft / Math.max(props.turnSeconds, 1)))
    : 0;
  return (
    <section className="panel p-4" aria-label="目前喊牌">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {round.bidSeq > 0 ? (
            <p className="text-sm font-semibold text-ink">
              目前喊牌：<span className="text-neon-gold">{round.bidCount} 個 {round.bidFace} 點</span>
              （{bidderName}）
            </p>
          ) : (
            <p className="text-sm text-ink-muted">尚未喊牌，由當前玩家開喊。</p>
          )}
        </div>
        <p
          aria-label="回合剩餘秒數"
          className={`font-display text-3xl font-black tabular-nums ${
            warn ? 'text-neon-pink' : 'text-ink'
          }`}
        >
          {secondsLeft}
        </p>
      </div>
      {round.status === 'bidding' ? (
        <div
          aria-hidden="true"
          className={`mt-2 h-1.5 rounded-full ${warn ? 'bg-neon-pink/50' : 'bg-white/15'}`}
        >
          <div
            className={`h-full rounded-full ${warn ? 'bg-neon-pink' : 'bg-neon-cyan/70'}`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      ) : null}
    </section>
  );
}

/** 操作區參數。 */
interface BidControlsProps {
  /** 目前回合。 */
  round: GameRound;
  /** 場上存活骰子總數（數量上限）。 */
  totalDice: number;
  /** 是否輪到自己。 */
  myTurn: boolean;
  /** 非自己回合時顯示的當前玩家名稱。 */
  waitingName: string;
  /** 送出中旗標（按鈕禁用）。 */
  busy: boolean;
  /** 按下喊牌時的回呼。 */
  onBid: (count: number, face: number) => void;
  /** 按下質疑時的回呼。 */
  onChallenge: () => void;
}

/**
 * 操作區：數量／點數 stepper 加喊牌鈕，質疑鈕在首喊（bid_seq=0）停用；
 * 非自己回合顯示「等待 ○○ 操作」並停用全部控制。
 *
 * @param props 操作區參數
 */
function BidControls(props: BidControlsProps) {
  const prev = props.round.bidSeq > 0 && props.round.bidCount != null && props.round.bidFace != null
    ? { count: props.round.bidCount, face: props.round.bidFace }
    : null;
  const [count, setCount] = useState(prev ? prev.count + 1 : 1);
  const [face, setFace] = useState(prev ? prev.face : 1);
  const valid = isValidBid(prev, count, face);

  // 新回合或新的一手時追平預設草稿（預設提出最小可喊的下一手）
  useEffect(() => {
    setCount(prev ? prev.count + 1 : 1);
    setFace(prev ? prev.face : BID_FACE_RANGE.min);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.round.roundNo, props.round.bidSeq]);

  /** 步進數量（1～場上骰子總數）。 */
  const stepCount = (delta: number) => {
    setCount((value) => Math.min(props.totalDice, Math.max(1, value + delta)));
  };
  /** 步進點數（1～6）。 */
  const stepFace = (delta: number) => {
    setFace((value) => Math.min(BID_FACE_RANGE.max, Math.max(BID_FACE_RANGE.min, value + delta)));
  };

  if (!props.myTurn) {
    return (
      <section className="panel p-4" aria-label="操作區">
        <p className="text-center text-sm text-ink-muted">等待 {props.waitingName} 操作</p>
      </section>
    );
  }
  return (
    <section className="panel p-4" aria-label="操作區">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-ink-muted">數量</p>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              aria-label="減少數量"
              onClick={() => stepCount(-1)}
              disabled={count <= 1}
              className="min-h-[44px] min-w-[44px] rounded-full border border-white/15 bg-white/5 text-lg font-bold text-ink disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-[2rem] text-center font-display text-xl font-black text-ink">
              {count}
            </span>
            <button
              type="button"
              aria-label="增加數量"
              onClick={() => stepCount(1)}
              disabled={count >= props.totalDice}
              className="min-h-[44px] min-w-[44px] rounded-full border border-white/15 bg-white/5 text-lg font-bold text-ink disabled:opacity-40"
            >
              ＋
            </button>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-ink-muted">點數</p>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              aria-label="減少點數"
              onClick={() => stepFace(-1)}
              disabled={face <= BID_FACE_RANGE.min}
              className="min-h-[44px] min-w-[44px] rounded-full border border-white/15 bg-white/5 text-lg font-bold text-ink disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-[2rem] text-center font-display text-xl font-black text-ink">
              {face}
            </span>
            <button
              type="button"
              aria-label="增加點數"
              onClick={() => stepFace(1)}
              disabled={face >= BID_FACE_RANGE.max}
              className="min-h-[44px] min-w-[44px] rounded-full border border-white/15 bg-white/5 text-lg font-bold text-ink disabled:opacity-40"
            >
              ＋
            </button>
          </div>
        </div>
      </div>
      {!valid ? (
        <p className="mt-2 text-xs text-neon-pink" role="alert">
          {prev
            ? `須大於前喊（${prev.count} 個 ${prev.face} 點）以上才能加碼`
            : ''}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => props.onBid(count, face)}
          disabled={!valid || props.busy}
          className="min-h-[48px] w-full rounded-full border border-neon-cyan/60 bg-neon-cyan/25 px-5 text-sm font-semibold text-ink transition hover:bg-neon-cyan/40 disabled:opacity-50"
        >
          {props.busy ? '送出中……' : `喊 ${count} 個 ${face} 點`}
        </button>
        {prev ? (
          <button
            type="button"
            onClick={props.onChallenge}
            disabled={props.busy}
            className="min-h-[48px] w-full rounded-full border border-neon-pink/50 bg-neon-pink/15 px-5 text-sm font-semibold text-neon-pink transition hover:bg-neon-pink/30 disabled:opacity-50"
          >
            質疑上一筆
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="本回合尚未有人喊牌，無法質疑"
            className="min-h-[48px] w-full cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-5 text-sm font-semibold text-ink-muted opacity-50"
          >
            質疑上一筆（首喊不可質疑）
          </button>
        )}
      </div>
    </section>
  );
}

/** 開盅覆蓋面板的參數。 */
interface RevealPanelProps {
  /** 開盅的回合編號。 */
  roundNo: number;
  /** 全員骰子。 */
  reveal: RevealEntry[];
  /** 玩家列（顯示名稱查閱）。 */
  players: PlayerView[];
  /** 結果描述（繁中）。 */
  note: string | null;
}

/**
 * 開盅顯示：全員骰子與結果描述；數秒後自動關閉（由上層控制）。
 *
 * @param props 面板參數
 */
function RevealPanel(props: RevealPanelProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-label={`第 ${props.roundNo} 輪開盅結果`}
      data-testid="reveal-panel"
    >
      <div className="panel w-full max-w-md p-5">
        <p className="text-center font-display text-lg font-bold text-ink">
          第 {props.roundNo} 輪 開盅
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {props.reveal.map((entry) => {
            const name =
              props.players.find((p) => p.userId === entry.user_id)?.displayName ?? '玩家';
            return (
              <li key={entry.user_id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{name}</span>
                <MiniDiceRow dice={entry.dice} />
              </li>
            );
          })}
        </ul>
        {props.note ? (
          <p className="mt-3 text-center text-sm text-ink" data-testid="resolve-note">
            {props.note}
          </p>
        ) : null}
        <p className="mt-3 text-center text-xs text-ink-muted">稍後自動進入下一輪……</p>
      </div>
    </div>
  );
}

/** 結算卡的參數。 */
interface GameOverCardProps {
  /** 勝者 user_id。 */
  winnerId: string | null;
  /** 玩家列（骰數總覽）。 */
  players: PlayerView[];
  /** 回到的大廳房間 ID。 */
  roomId: string;
}

/**
 * 遊戲結束：勝者、玩家骰數總覽與「再玩一局（回大廳）」。
 *
 * @param props 結算卡參數
 */
function GameOverCard(props: GameOverCardProps) {
  const winner = props.players.find((p) => p.userId === props.winnerId);
  return (
    <section className="panel p-5 text-center" aria-label="遊戲結束">
      <p className="font-display text-xl font-black text-neon-gold">
        {winner ? `${winner.displayName ?? '玩家'} 獲勝` : '遊戲結束'}
      </p>
      <ul className="mt-3 flex flex-col gap-1">
        {props.players.map((player) => (
          <li key={player.userId} className="flex justify-between text-sm text-ink-muted">
            <span>{player.displayName ?? '玩家'}</span>
            <span>
              {player.eliminated ? '已淘汰' : `骰 ×${player.diceLeft}`}
            </span>
          </li>
        ))}
      </ul>
      <Link
        to={`/games/room/${props.roomId}`}
        className={`${GAMES_LINK_BTN} mt-4`}
        data-testid="back-to-lobby"
      >
        再玩一局（回大廳）
      </Link>
    </section>
  );
}

/**
 * 遊戲主畫面本體（已通過登入守門）。
 *
 * @returns 六大區的組合畫面
 */
function PlayDetail() {
  const { sessionId: rawSessionId } = useParams();
  const sessionId = Number(rawSessionId);
  const { user } = useAuth();

  // 倒數節拍：現在時刻每 500ms 更新一次，回到前景立即重算
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    const recompute = () => setNowMs(Date.now());
    document.addEventListener('visibilitychange', recompute);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', recompute);
    };
  }, []);

  const { session, round, players, dice, loading, error } = useGameState(
    Number.isFinite(sessionId) ? sessionId : -1,
    // 開盅列以事件直送（reveal 事件與下一回合在同一交易送達、批次更新
    // 會跳過中間渲染，須在訂閱回呼上拋，見下方 applyReveal）
    (round) => applyRevealRef.current(round),
  );

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // 逾時呼叫節流：以「回合＋手數」為鍵，同一鍵只送一次
  const lastTimeoutKeyRef = useRef<string>('');
  // 開盅顯示：以「回合＋手數」為鍵，避免同一開盅反覆觸發
  const lastRevealKeyRef = useRef<string>('');
  const [revealView, setRevealView] = useState<
    { roundNo: number; entries: RevealEntry[]; note: string | null } | null
  >(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 倒數歸零：呼叫一次 sync_timeout（逾時代理；SQL 端冪等），前端節流防重複
  useEffect(() => {
    if (!round || round.status !== 'bidding') return;
    if (Date.parse(round.deadlineAt) > nowMs) return;
    const key = `${round.roundNo}:${round.bidSeq}`;
    if (lastTimeoutKeyRef.current === key) return;
    lastTimeoutKeyRef.current = key;
    void syncTimeout(sessionId).catch(() => {
      // 逾時同步失敗靜默：下一手或他人的呼叫會再補（SQL 冪等）
    });
  }, [round, nowMs, sessionId]);

  // 開盅顯示共用入口：以「回合＋手數」為鍵去重，展開後數秒自動關閉。
  // 兩條來源：(1) 訂閱事件 onReveal——challenge_bid 的開盅事件與下一回合
  // 在同一交易送出且間隔極短，批次更新可能跳過中間渲染，不能只靠
  // (2) 下方的回合狀態 effect（重新整理時抓到既有開盅列的兜底）。
  const applyReveal = (target: GameRound) => {
    if (!target.reveal || session?.winner) return;
    const key = `${target.roundNo}:${target.bidSeq}`;
    if (lastRevealKeyRef.current === key) return;
    lastRevealKeyRef.current = key;
    setRevealView({ roundNo: target.roundNo, entries: target.reveal, note: target.resolveNote });
    clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => setRevealView(null), REVEAL_SHOW_MS);
  };
  const applyRevealRef = useRef(applyReveal);
  applyRevealRef.current = applyReveal;

  useEffect(() => {
    if (!round || !round.reveal || session?.winner) return;
    applyRevealRef.current(round);
  }, [round, session?.winner]);
  useEffect(() => () => clearTimeout(revealTimerRef.current), []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 text-center">
        <p className="text-sm text-ink-muted">遊戲載入中，請稍候……</p>
      </div>
    );
  }
  if (error || !session) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="font-display text-xl font-bold text-ink">遊戲局不存在或連線出現問題</p>
        <p className="text-sm text-ink-muted">{error ?? '請回到遊戲首頁重新開局。'}</p>
        <Link to="/games" className={GAMES_LINK_BTN}>
          回到遊戲首頁
        </Link>
      </div>
    );
  }

  const gameOver = Boolean(session.winner);
  const alivePlayers = players.filter((p) => !p.eliminated);
  const totalDice = alivePlayers.reduce((sum, p) => sum + p.diceLeft, 0);
  const me = players.find((p) => p.userId === user?.id) ?? null;
  const myTurn =
    round?.status === 'bidding' &&
    Boolean(me && !me.eliminated && me.seat === round.currentSeat) &&
    !gameOver;

  /** 送出喊牌；失敗時顯示繁中錯誤。 */
  const handleBid = async (count: number, face: number) => {
    if (busy || myTurn === false) return;
    setBusy(true);
    setActionError(null);
    try {
      await submitBid(sessionId, count, face);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '喊牌失敗，請再試一次。');
    } finally {
      setBusy(false);
    }
  };

  /** 送出質疑；失敗時顯示繁中錯誤。 */
  const handleChallenge = async () => {
    if (busy || myTurn === false) return;
    setBusy(true);
    setActionError(null);
    try {
      await challengeBid(sessionId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '質疑失敗，請再試一次。');
    } finally {
      setBusy(false);
    }
  };

  // 等待提示中，「○○」換成實際的當前玩家名（非自己回合才有意義）
  const currentActor = players.find(
    (p) => !p.eliminated && p.seat === round?.currentSeat,
  );

  return (
    <div className="pb-36 pt-6 sm:pb-24">
      <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 sm:px-6">
        <PlayTopBar roomId={session.roomId} roundNo={round?.roundNo ?? 1} />
        <PlayerStrip
          players={players}
          currentSeat={round?.currentSeat ?? 0}
          selfId={user?.id ?? null}
        />

        {round ? (
          <BidStatusRow round={round} players={players} nowMs={nowMs} turnSeconds={session.turnSeconds} />
        ) : null}

        <section aria-label="我的骰子" className="panel p-4">
          <p className="text-xs font-semibold text-ink-muted">
            我的骰子
            {me && !me.eliminated ? `：剩 ${me.diceLeft} 顆` : ''}
          </p>
          {me?.eliminated ? (
            <p className="mt-2 text-sm font-semibold text-ink-muted">已淘汰，本局觀戰等待結束。</p>
          ) : dice && dice.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2" data-testid="my-dice">
              {dice.map((value, index) => (
                <DiceFace key={index} value={value} size={56} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">等待擲骰……</p>
          )}
        </section>

        {gameOver ? (
          <GameOverCard winnerId={session.winner} players={players} roomId={session.roomId} />
        ) : round && me && !me.eliminated ? (
          <BidControls
            round={round}
            totalDice={totalDice}
            myTurn={myTurn}
            waitingName={currentActor?.displayName ?? '玩家'}
            busy={busy}
            onBid={(count, face) => void handleBid(count, face)}
            onChallenge={() => void handleChallenge()}
          />
        ) : null}

        {actionError ? (
          <p className="text-xs text-neon-pink" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>

      {/* 開盅覆蓋：數秒後自動關閉並顯示新回合 */}
      {revealView ? (
        <RevealPanel
          roundNo={revealView.roundNo}
          reveal={revealView.entries}
          players={players}
          note={revealView.note}
        />
      ) : null}
    </div>
  );
}

/**
 * /games/play/:sessionId 遊戲主畫面。
 */
export function GamePlayPage() {
  return (
    <GamesAuthGate>
      <PlayDetail />
    </GamesAuthGate>
  );
}
