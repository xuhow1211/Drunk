/**
 * /games/play/:sessionId 遊戲主畫面（六大區、手機優先單欄）。
 *
 * 頂列（房 ID／第 N 輪／離開）→ 玩家狀態列 → 目前喊牌＋倒數 →
 * 我的骰子（大型 SVG 骰面，回合開始短暫搖骰）→ 操作區（加碼與質疑；
 * 開盅後的回合在 await_ack 時改為全員確認面板）→
 * 開盅顯示（可關閉的覆蓋，關閉後留可收合摘要）→ 遊戲事件紀錄
 * （可展開，最新在上）→ 遊戲結束的結算卡（勝者、排名、個人戰績）。
 *
 * 局況全部由 useGameState（postgres_changes 訂閱）維護；倒數以後端
 * deadline_at 與本機時間差計算（回到前景即重算），歸零時呼叫一次
 * sync_timeout（以回合＋手數＋狀態為鍵節流，防重複呼叫）。
 * 開盅後的新回合落在 await_ack（待全員確認開盅結果），deadline 此時為
 * 「確認逾時上限」：全員按下確認（ack_reveal）或逾時由系統代為確認後，
 * 才轉入 bidding 並以 now() 重設真正的喊牌倒數起點。
 * 桌機（≥1024px）改雙欄：左玩家列／右主操作與紀錄，手機維持單欄基準。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/authStore';
import {
  ackReveal,
  challengeBid,
  fetchGameEvents,
  fetchPlayerStats,
  replayGameRoom,
  submitBid,
  syncTimeout,
  useGameLog,
  useGameState,
} from '../../lib/games/gameClient';
import type { GameLogEntry } from '../../lib/games/gameClient';
import { fetchRoom } from '../../lib/games/roomClient';
import type {
  GameRound,
  PlayerStats,
  PlayerView,
  RevealEntry,
} from '../../lib/games/gameTypes';
import { BID_FACE_RANGE, isValidBid } from '../../lib/games/bidRules';
import { GAMES_LINK_BTN, GamesAuthGate } from './GamesAuthGate';

/** 開盅顯示的停留上限毫秒數（之後自動切回新回合視圖，可提前關閉）。 */
const REVEAL_SHOW_MAX_MS = 6000;

/** 開盅顯示的停留下限毫秒數（短回合仍看得清開盅結果）。 */
const REVEAL_SHOW_MIN_MS = 1500;

/** 倒數警示門檻（秒）：剩餘 ≤ 5 秒改為警示色。 */
const COUNTDOWN_WARN_SECONDS = 5;

/** 倒數加強門檻（秒）：剩餘 ≤ 3 秒加大字級與警示框（不閃爍）。 */
const COUNTDOWN_ALERT_SECONDS = 3;

/** 逾時代打提示的顯示毫秒數（到時自動收起，不遮擋操作區）。 */
const PROXY_NOTICE_MS = 4000;

/** 逾時代打的偵測延遲毫秒（等訂閱事件與 game_actions 落地後查證）。 */
const PROXY_DETECT_DELAY_MS = 1200;

/** 開盅逐張翻牌的單張延遲毫秒（總長以動畫上限內收斂）。 */
const REVEAL_STAGGER_MS = 90;

/** 開盅逐張翻牌的總延遲上限毫秒（人多骰多時不再線性拉長）。 */
const REVEAL_STAGGER_TOTAL_MS = 720;

/** 是否偏好減少動態（prefers-reduced-motion；直接顯示最終結果）。 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

/** 小型骰面列（開盅顯示用；帶逐張翻牌的遞延）。 */
function MiniDiceRow(props: { dice: number[]; startDelay?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {props.dice.map((value, index) => (
        <span
          key={index}
          className={props.startDelay == null ? undefined : 'dice-reveal'}
          style={
            props.startDelay == null
              ? undefined
              : {
                  animationDelay: `${Math.min(
                    props.startDelay + index * REVEAL_STAGGER_MS,
                    REVEAL_STAGGER_TOTAL_MS,
                  )}ms`,
                }
          }
        >
          <DiceFace value={value} size={26} />
        </span>
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
 * 目前喊牌行：bid_seq=0 顯示「尚未喊牌」；大字倒數（本機時間差）。
 * 倒數警示分兩級：≤5 秒轉警示色並加「時間不多了」文字；
 * ≤3 秒再加強——字級放大、警示框與「即將逾時」標籤。
 * await_ack（待全員確認開盅結果）時改顯示確認進度，倒數此時為
 * 「確認逾時上限」（逾時由系統代為確認），不套用喊牌警示階梯。
 * 一律以文字與框線同步提示，不以顏色為唯一手段，且不閃爍。
 *
 * @param props 行參數
 */
function BidStatusRow(props: BidStatusRowProps) {
  const { round, players } = props;
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(round.deadlineAt) - props.nowMs) / 1000));
  const bidding = round.status === 'bidding';
  const awaitingAck = round.status === 'await_ack';
  const alivePlayers = players.filter((p) => !p.eliminated);
  const ackedCount = alivePlayers.filter((p) => p.ackRoundNo >= round.roundNo).length;
  const warn = secondsLeft <= COUNTDOWN_WARN_SECONDS && bidding;
  const alert = secondsLeft <= COUNTDOWN_ALERT_SECONDS && bidding;
  const bidder = players.find((p) => p.userId === round.bidUser);
  const bidderName = bidder?.displayName ?? '玩家';
  const ratio = bidding
    ? Math.min(1, Math.max(0, secondsLeft / Math.max(props.turnSeconds, 1)))
    : 0;
  return (
    <section className="panel p-4" aria-label="目前喊牌">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {awaitingAck ? (
            <p className="text-sm font-semibold text-ink">
              開盅結果待全員確認（
              <span className="text-neon-gold">{ackedCount}／{alivePlayers.length} 已確認</span>），
              全員確認後才開始喊牌倒數。
            </p>
          ) : round.bidSeq > 0 ? (
            <p className="text-sm font-semibold text-ink">
              目前喊牌：<span className="text-xl font-bold text-neon-gold">{round.bidCount} 個 {round.bidFace} 點</span>
              （{bidderName}）
            </p>
          ) : (
            <p className="text-sm text-ink-muted">尚未喊牌，由當前玩家開喊。</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div
            className={
              alert
                ? 'rounded-2xl border-2 border-neon-pink bg-neon-pink/15 px-2.5 py-0.5'
                : 'border-2 border-transparent px-2.5 py-0.5'
            }
          >
            <p
              aria-label="回合剩餘秒數"
              className={`font-display font-black tabular-nums ${
                alert ? 'text-5xl' : 'text-3xl'
              } ${warn ? 'text-neon-pink' : 'text-ink'}`}
            >
              {secondsLeft}
            </p>
          </div>
          {alert ? (
            <p className="flex items-center gap-1 text-xs font-bold text-neon-pink">
              <span aria-hidden="true">[!]</span> 即將逾時
            </p>
          ) : warn ? (
            <p className="flex items-center gap-1 text-xs font-semibold text-neon-pink">
              <span aria-hidden="true">[!]</span> 時間不多了
            </p>
          ) : awaitingAck ? (
            <p className="text-xs font-semibold text-ink-muted">確認逾時上限</p>
          ) : null}
        </div>
      </div>
      {bidding ? (
        <div
          aria-hidden="true"
          className={`mt-2 h-1.5 rounded-full ${warn ? 'bg-neon-pink/50' : 'bg-white/15'}`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ease-linear ${
              warn ? 'bg-neon-pink' : 'bg-neon-cyan/70'
            }`}
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
 * 數量草稿一律夾在 1～場上骰子總數（totalDice）：有人淘汰後
 * 舊草稿可能超出上限，直接收斂避免送出必然被 SQL 拒絕的喊牌。
 *
 * @param props 操作區參數
 */
function BidControls(props: BidControlsProps) {
  const prev = props.round.bidSeq > 0 && props.round.bidCount != null && props.round.bidFace != null
    ? { count: props.round.bidCount, face: props.round.bidFace }
    : null;
  const clampCount = (value: number) =>
    Math.max(1, Math.min(props.totalDice, value));
  const [count, setCount] = useState(() => clampCount(prev ? prev.count + 1 : 1));
  const [face, setFace] = useState(prev ? prev.face : 1);
  const valid = isValidBid(prev, count, face);

  // 新回合或新的一手時追平預設草稿（預設提出最小可喊的下一手，並夾上限）
  useEffect(() => {
    setCount(clampCount(prev ? prev.count + 1 : 1));
    setFace(prev ? prev.face : BID_FACE_RANGE.min);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.round.roundNo, props.round.bidSeq, props.totalDice]);

  /** 步進數量（1～場上骰子總數）。 */
  const stepCount = (delta: number) => {
    setCount((value) => clampCount(value + delta));
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
          <p className="text-lg font-semibold text-ink-muted">數量</p>
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
          <p className="text-lg font-semibold text-ink-muted">點數</p>
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

/** 開盅確認面板的參數。 */
interface AckConfirmPanelProps {
  /** 目前回合（await_ack 中；deadline 為確認逾時上限）。 */
  round: GameRound;
  /** 玩家列（確認進度與自己是否已確認）。 */
  players: PlayerView[];
  /** 自己的 user_id。 */
  selfId: string | null;
  /** 現在時刻（毫秒；顯示確認逾時倒數）。 */
  nowMs: number;
  /** 送出中旗標（按鈕禁用）。 */
  busy: boolean;
  /** 按下確認時的回呼。 */
  onAck: () => void;
}

/**
 * 開盅確認面板：新回合落在 await_ack 時取代操作區。
 * 顯示已確認人數（含自己確認後的等待提示）與逾時剩餘秒數；
 * 全員確認（或逾時由系統代為確認）後 SQL 端轉入 bidding、重設倒數，
 * 本面板即由操作區取代。自己的確認為冪等 RPC，重複按下不會出錯。
 *
 * @param props 面板參數
 */
function AckConfirmPanel(props: AckConfirmPanelProps) {
  const alive = props.players.filter((p) => !p.eliminated);
  const ackedCount = alive.filter((p) => p.ackRoundNo >= props.round.roundNo).length;
  const iAcked = props.players.some(
    (p) => p.userId === props.selfId && p.ackRoundNo >= props.round.roundNo,
  );
  const secondsLeft = Math.max(
    0,
    Math.ceil((Date.parse(props.round.deadlineAt) - props.nowMs) / 1000),
  );
  return (
    <section className="panel p-4" aria-label="開盅確認" data-testid="ack-panel">
      <p className="text-center text-sm font-semibold text-ink" data-testid="ack-progress">
        上一手已開盅，待全員確認（{ackedCount}／{alive.length}）
      </p>
      <p className="mt-1 text-center text-xs text-ink-muted">
        全員確認後才開始下一輪倒數；逾時由系統代為確認（剩 {secondsLeft} 秒）
      </p>
      {iAcked ? (
        <p className="mt-3 text-center text-sm font-semibold text-neon-cyan">
          已確認，等待其他玩家……
        </p>
      ) : (
        <button
          type="button"
          onClick={props.onAck}
          disabled={props.busy}
          data-testid="ack-reveal"
          className="mt-3 min-h-[48px] w-full rounded-full border border-neon-cyan/60 bg-neon-cyan/25 px-5 text-sm font-semibold text-ink transition hover:bg-neon-cyan/40 disabled:opacity-50"
        >
          {props.busy ? '送出中……' : '看過結果，開始下一輪'}
        </button>
      )}
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
  /** 按下關閉時的回呼（關閉後上層改顯示可收合的開盅摘要）。 */
  onClose: () => void;
}

/**
 * 開盅顯示：全員骰子與結果描述；骰子逐張翻出（依序延遲），
 * 可由關閉鈕提前收起，亦可等自動關閉（由上層計時）。
 *
 * @param props 面板參數
 */
function RevealPanel(props: RevealPanelProps) {
  // 逐張翻牌：以「前面所有玩家的骰子總數」為本玩家的起始延遲
  let offset = 0;
  const startDelays = props.reveal.map((entry) => {
    const start = offset;
    offset += entry.dice.length;
    return Math.min(start * REVEAL_STAGGER_MS, REVEAL_STAGGER_TOTAL_MS);
  });
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
          {props.reveal.map((entry, listIndex) => {
            const name =
              props.players.find((p) => p.userId === entry.user_id)?.displayName ?? '玩家';
            return (
              <li key={entry.user_id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{name}</span>
                <MiniDiceRow dice={entry.dice} startDelay={startDelays[listIndex]} />
              </li>
            );
          })}
        </ul>
        {props.note ? (
          <p className="mt-3 text-center text-sm text-ink" data-testid="resolve-note">
            {props.note}
          </p>
        ) : null}
        <p className="mt-3 text-center text-xs text-ink-muted">
          稍後自動收起，可提前關閉。
        </p>
        <button
          type="button"
          onClick={props.onClose}
          data-testid="reveal-close"
          className="mt-2 min-h-[44px] w-full rounded-full border border-white/20 bg-white/10 px-5 text-sm font-semibold text-ink transition hover:bg-white/20"
        >
          關閉（留下摘要）
        </button>
      </div>
    </div>
  );
}

/** 開盅摘要（覆蓋關閉後留下的可收合條，不遮擋操作區）。 */
interface RevealSummaryCardProps {
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
 * 開盅摘要條：預設收合只佔一行（結果描述），展開後可回看全員骰子。
 *
 * @param props 摘要參數
 */
function RevealSummaryCard(props: RevealSummaryCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel p-3" aria-label="開盅摘要" data-testid="reveal-summary">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-xs font-semibold text-ink"
      >
        <span className="min-w-0 truncate">
          第 {props.roundNo} 輪開盅{props.note ? `：${props.note}` : ''}
        </span>
        <span aria-hidden="true" className="shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {props.reveal.map((entry) => {
            const name =
              props.players.find((p) => p.userId === entry.user_id)?.displayName ?? '玩家';
            return (
              <li key={entry.user_id} className="flex items-center justify-between gap-3">
                <span className="text-xs text-ink">{name}</span>
                <MiniDiceRow dice={entry.dice} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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
  /** 自己的 user_id（戰績與房主判斷）。 */
  selfId: string | null;
}

/**
 * 遊戲結束：勝者大卡、玩家排名列表（依剩餘骰數）、個人戰績變化，
 * 以及「再玩一局」（房主：呼叫 replay_room 重開房間；非房主：按鈕消失，
 * 提示待房主重開）與「返回大廳」。
 *
 * @param props 結算卡參數
 */
function GameOverCard(props: GameOverCardProps) {
  const navigate = useNavigate();
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);

  // 房主對映（供「房主重開」判斷）與個人戰績：各抓一次即可
  useEffect(() => {
    let cancelled = false;
    void fetchRoom(props.roomId)
      .then((room) => {
        if (!cancelled) setHostId(room?.hostId ?? null);
      })
      .catch(() => {});
    if (props.selfId) {
      void fetchPlayerStats(props.selfId)
        .then((value) => {
          if (!cancelled) setStats(value);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 房主重開房間：成功後回大廳（該房已轉回 waiting）。 */
  const handleReplay = async () => {
    if (replaying) return;
    setReplaying(true);
    setReplayError(null);
    try {
      await replayGameRoom(props.roomId);
      navigate(`/games/room/${props.roomId}`);
    } catch (cause) {
      setReplayError(cause instanceof Error ? cause.message : '重開房間失敗，請再試一次。');
      setReplaying(false);
    }
  };

  const winner = props.players.find((p) => p.userId === props.winnerId);
  // 排名：剩餘骰數多者在前；淘汰者按席位排在其後
  const ranked = useMemo(() => {
    const alive = props.players
      .filter((p) => !p.eliminated)
      .sort((a, b) => b.diceLeft - a.diceLeft);
    const out = props.players.filter((p) => p.eliminated).sort((a, b) => a.seat - b.seat);
    return [...alive, ...out];
  }, [props.players]);
  const isHost = Boolean(hostId && props.selfId && hostId === props.selfId);
  const winRate = stats && stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : null;

  return (
    <section className="panel p-5 text-center" aria-label="遊戲結束" data-testid="game-over">
      <p className="font-display text-2xl font-black neon-text">
        {winner ? `${winner.displayName ?? '玩家'} 獲勝` : '遊戲結束'}
      </p>
      {winner ? (
        <p className="mt-1 text-xs text-ink-muted">
          剩餘 {winner.diceLeft} 顆骰子，撐到最後一方勝出
        </p>
      ) : null}
      {/* 玩家排名列表：名次、名稱、剩餘骰數 */}
      <ol className="mt-4 flex flex-col gap-1.5" data-testid="game-over-ranking">
        {ranked.map((player, index) => (
          <li
            key={player.userId}
            className={`flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm ${
              player.eliminated ? 'opacity-60 grayscale' : ''
            }`}
          >
            <span className="w-6 text-center font-display font-black text-ink-muted">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-ink">
              {player.displayName ?? '玩家'}
              {player.userId === props.selfId ? (
                <span className="ml-1 text-xs text-ink-muted">（你）</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs font-semibold text-neon-gold">
              {player.eliminated ? '已淘汰' : `骰 ×${player.diceLeft}`}
            </span>
          </li>
        ))}
      </ol>
      {/* 個人戰績變化（本人列）：games／wins／勝率／連勝 */}
      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2" data-testid="self-stats">
        <p className="text-xs font-semibold text-ink-muted">我的戰績</p>
        {stats ? (
          <p className="mt-1 text-sm text-ink" data-testid="self-stats-text">
            {stats.games} 戰 {stats.wins} 勝（勝率 {winRate ?? 0}%）・目前連勝 {stats.currentStreak}
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">首次對局結算後即有戰績</p>
        )}
      </div>
      {isHost ? (
        <button
          type="button"
          onClick={() => void handleReplay()}
          disabled={replaying}
          data-testid="replay-room"
          className={`${GAMES_LINK_BTN} mt-4 w-full`}
        >
          {replaying ? '重開房間中……' : '再玩一局（房主重開）'}
        </button>
      ) : (
        <p className="mt-4 text-xs text-ink-muted">待房主重開房間後即可再玩一局。</p>
      )}
      {replayError ? (
        <p className="mt-2 text-xs text-neon-pink" role="alert">
          {replayError}
        </p>
      ) : null}
      <Link
        to={`/games/room/${props.roomId}`}
        className={`${GAMES_LINK_BTN} mt-3 w-full`}
        data-testid="back-to-lobby"
      >
        返回大廳
      </Link>
    </section>
  );
}

/** 遊戲事件紀錄區的參數。 */
interface EventsPanelProps {
  /** 事件條目（最新在前）。 */
  entries: GameLogEntry[];
}

/**
 * 遊戲事件紀錄（規劃書 §9.2 第六區）：可展開區塊，預設收合。
 * 列出喊牌、質疑、逾時代打與淘汰事件，最新在上、上限 30 筆。
 *
 * @param props 面板參數
 */
function EventsPanel(props: EventsPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel p-4" aria-label="遊戲事件紀錄" data-testid="game-events">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[44px] w-full items-center justify-between text-sm font-semibold text-ink"
      >
        遊戲事件紀錄
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        props.entries.length > 0 ? (
          <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1 text-xs">
            {props.entries.map((entry) => (
              <li
                key={entry.key}
                className="flex items-baseline justify-between gap-2 border-b border-white/5 pb-1.5 last:border-b-0"
              >
                <span className="text-ink">{entry.text}</span>
                <time className="shrink-0 text-ink-muted">
                  {new Date(entry.at).toLocaleTimeString('zh-TW', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-muted">還沒有事件，喊出第一手吧。</p>
        )
      ) : null}
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
  // 開盅摘要：覆蓋關閉（按鈕或計時）後留下的可收合條，不遮擋操作區
  const [revealSummary, setRevealSummary] = useState<
    { roundNo: number; entries: RevealEntry[]; note: string | null } | null
  >(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 開盅停留時長：上限 REVEAL_SHOW_MAX_MS，並留出回合時限 800ms 的操作空間
  const revealShowMs = Math.min(
    REVEAL_SHOW_MAX_MS,
    Math.max(REVEAL_SHOW_MIN_MS, (session?.turnSeconds ?? 8) * 1000 - 800),
  );
  // 逾時代打提示（一次性；顯示 PROXY_NOTICE_MS 後自動收起）
  const [proxyNotice, setProxyNotice] = useState<string | null>(null);
  const proxyNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const proxyDetectTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 我的骰子搖骰：以「回合編號」為鍵，同一回合只搖一次
  const lastShakenRoundRef = useRef<number>(0);
  const [shaking, setShaking] = useState(false);

  // 倒數歸零：呼叫一次 sync_timeout（逾時代理；SQL 端冪等），前端節流防重複。
  // await_ack 的到期意義為「確認逾時上限」：SQL 端代全員確認後轉入 bidding。
  // 鍵含狀態：同一回合由 await_ack 轉入 bidding 時（deadline 重設前後）
  // 不會被同一鍵擋下，兩階段各自只送一次。
  useEffect(() => {
    if (!round || (round.status !== 'bidding' && round.status !== 'await_ack')) return;
    if (Date.parse(round.deadlineAt) > nowMs) return;
    const key = `${round.roundNo}:${round.bidSeq}:${round.status}`;
    if (lastTimeoutKeyRef.current === key) return;
    lastTimeoutKeyRef.current = key;
    void syncTimeout(sessionId).catch(() => {
      // 逾時同步失敗靜默：下次到期或他人的呼叫會再補（SQL 冪等）
    });
  }, [round, nowMs, sessionId]);

  // 我的骰子載入（新回合）時短暫搖骰；偏好減少動態者直接顯示結果
  useEffect(() => {
    if (!round || !dice || dice.length === 0) return;
    if (lastShakenRoundRef.current === round.roundNo) return;
    lastShakenRoundRef.current = round.roundNo;
    if (prefersReducedMotion()) return;
    setShaking(true);
    const timer = setTimeout(() => setShaking(false), 700);
    return () => clearTimeout(timer);
  }, [round, dice]);

  // 遊戲事件紀錄（最新在前）：操作事件讀 game_actions，淘汰由訂閱累計
  const logEntries = useGameLog(sessionId, players, round?.roundNo, round?.bidSeq);

  /** 顯示一次性訊息（逾時／系統提示），顯示 PROXY_NOTICE_MS 後自動收起。 */
  const showProxyNotice = (text: string) => {
    setProxyNotice(text);
    clearTimeout(proxyNoticeTimerRef.current);
    proxyNoticeTimerRef.current = setTimeout(() => setProxyNotice(null), PROXY_NOTICE_MS);
  };

  // 開盅顯示共用入口：以「回合＋手數」為鍵去重，展開後停留 revealShowMs
  // （可由關閉鈕提前收起）。兩條來源：(1) 訂閱事件 onReveal——challenge_bid
  // 的開盅事件與下一回合在同一交易送出且間隔極短，批次更新可能跳過中間
  // 渲染，不能只靠 (2) 下方的回合狀態 effect（重新整理時抓到既有開盅列）。
  const applyReveal = (target: GameRound) => {
    if (!target.reveal || session?.winner) return;
    const key = `${target.roundNo}:${target.bidSeq}`;
    if (lastRevealKeyRef.current === key) return;
    lastRevealKeyRef.current = key;
    const view = {
      roundNo: target.roundNo,
      entries: target.reveal,
      note: target.resolveNote,
    };
    setRevealSummary(null);
    setRevealView(view);
    clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setRevealView(null);
      setRevealSummary(view);
    }, revealShowMs);
  };
  const applyRevealRef = useRef(applyReveal);
  applyRevealRef.current = applyReveal;

  /** 立即關閉開盅（覆蓋 → 摘要條），並清掉自動關閉計時。 */
  const closeRevealNow = () => {
    const current = revealView;
    if (!current) return;
    clearTimeout(revealTimerRef.current);
    setRevealView(null);
    setRevealSummary({ ...current });
  };

  useEffect(() => {
    if (!round || !round.reveal || session?.winner) return;
    applyRevealRef.current(round);
  }, [round, session?.winner]);
  useEffect(
    () => () => {
      clearTimeout(revealTimerRef.current);
      clearTimeout(proxyNoticeTimerRef.current);
      for (const timer of proxyDetectTimersRef.current) clearTimeout(timer);
    },
    [],
  );

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

  /**
   * 逾時代打的回覆查證（審查第 5 項）：送出的操作若在 deadline 已過的
   * 手上執行，SQL 會先代打再看是否仍是自己的回合，代打結果會回 204。
   * 回覆成功後短等再查 game_actions：該回合最新一筆若為 timeout_*，
   * 顯示一次性行內提示（不遮擋，數秒自動收起）。
   *
   * @param capturedRoundNo 送出時的回合編號
   */
  const detectProxyActed = (capturedRoundNo: number) => {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const events = await fetchGameEvents(sessionId, 6);
          const forRound = events.filter((event) => event.roundNo === capturedRoundNo);
          const top = forRound[0];
          if (top && (top.action === 'timeout_bid' || top.action === 'timeout_challenge')) {
            showProxyNotice('回合已逾時，系統代你操作完成，你的動作未採用。');
          }
        } catch {
          // 查證失敗不打擾玩家（僅少了提示）
        }
      })();
    }, PROXY_DETECT_DELAY_MS);
    proxyDetectTimersRef.current.push(timer);
  };

  /** 送出喊牌；失敗時顯示繁中錯誤；逾時被代打時顯示一次性提示。 */
  const handleBid = async (count: number, face: number) => {
    if (busy || myTurn === false) return;
    const capturedRoundNo = round?.roundNo;
    const deadlinePassed = round
      ? Date.parse(round.deadlineAt) <= Date.now()
      : false;
    setBusy(true);
    setActionError(null);
    try {
      await submitBid(sessionId, count, face);
      if (deadlinePassed && capturedRoundNo != null) detectProxyActed(capturedRoundNo);
    } catch (cause) {
      // 逾時已在伺服端代打：此時送出會收到「不是你的回合」類錯誤，
      // 同樣走查證顯示一次性提示，不以原始錯誤誤導玩家
      if (deadlinePassed && capturedRoundNo != null) {
        detectProxyActed(capturedRoundNo);
        setActionError(null);
      } else {
        setActionError(cause instanceof Error ? cause.message : '喊牌失敗，請再試一次。');
      }
    } finally {
      setBusy(false);
    }
  };

  /** 送出質疑；失敗時顯示繁中錯誤；逾時被代打時顯示一次性提示。 */
  const handleChallenge = async () => {
    if (busy || myTurn === false) return;
    const capturedRoundNo = round?.roundNo;
    const deadlinePassed = round
      ? Date.parse(round.deadlineAt) <= Date.now()
      : false;
    setBusy(true);
    setActionError(null);
    try {
      await challengeBid(sessionId);
      if (deadlinePassed && capturedRoundNo != null) detectProxyActed(capturedRoundNo);
    } catch (cause) {
      if (deadlinePassed && capturedRoundNo != null) {
        detectProxyActed(capturedRoundNo);
        setActionError(null);
      } else {
        setActionError(cause instanceof Error ? cause.message : '質疑失敗，請再試一次。');
      }
    } finally {
      setBusy(false);
    }
  };

  /** 確認看過開盅結果（冪等）：全員確認完 SQL 端自動轉入喊牌並重設倒數。 */
  const handleAck = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await ackReveal(sessionId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '確認失敗，請再試一次。');
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
      <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 sm:px-6 lg:max-w-[1020px] lg:grid lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className="lg:col-span-2">
          <PlayTopBar roomId={session.roomId} roundNo={round?.roundNo ?? 1} />
        </div>
        <div className="lg:col-start-1">
          <PlayerStrip
            players={players}
            currentSeat={round?.currentSeat ?? 0}
            selfId={user?.id ?? null}
          />
        </div>

        {round ? (
          <div className="lg:col-start-2">
            <BidStatusRow
              round={round}
              players={players}
              nowMs={nowMs}
              turnSeconds={session.turnSeconds}
            />
          </div>
        ) : null}

        <div className="lg:col-start-2">
          <section aria-label="我的骰子" className="panel p-4">
            <p className="text-xs font-semibold text-ink-muted">
              我的骰子
              {me && !me.eliminated ? `：剩 ${me.diceLeft} 顆` : ''}
            </p>
            {me?.eliminated ? (
              <p className="mt-2 text-sm font-semibold text-ink-muted">已淘汰，本局觀戰等待結束。</p>
            ) : dice && dice.length > 0 ? (
              <div
                className={`mt-2 flex flex-wrap gap-2 ${shaking ? 'dice-shake' : ''}`}
                data-testid="my-dice"
              >
                {dice.map((value, index) => (
                  <DiceFace key={index} value={value} size={56} />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">等待擲骰……</p>
            )}
          </section>
        </div>

        {gameOver ? (
          <div className="lg:col-start-2">
            <GameOverCard
              winnerId={session.winner}
              players={players}
              roomId={session.roomId}
              selfId={user?.id ?? null}
            />
          </div>
        ) : round && me && !me.eliminated ? (
          <div className="lg:col-start-2">
            {round.status === 'await_ack' ? (
              <AckConfirmPanel
                round={round}
                players={players}
                selfId={user?.id ?? null}
                nowMs={nowMs}
                busy={busy}
                onAck={() => void handleAck()}
              />
            ) : (
              <BidControls
                round={round}
                totalDice={totalDice}
                myTurn={myTurn}
                waitingName={currentActor?.displayName ?? '玩家'}
                busy={busy}
                onBid={(count, face) => void handleBid(count, face)}
                onChallenge={() => void handleChallenge()}
              />
            )}
          </div>
        ) : null}

        {actionError || proxyNotice ? (
          <div className="lg:col-start-2" data-testid="action-notice">
            {actionError ? (
              <p className="text-xs text-neon-pink" role="alert">
                {actionError}
              </p>
            ) : null}
            {proxyNotice ? (
              <p className="text-xs text-neon-gold" role="status" data-testid="proxy-notice">
                [!] {proxyNotice}
              </p>
            ) : null}
          </div>
        ) : null}

        {revealSummary ? (
          <div className="lg:col-start-2">
            <RevealSummaryCard
              roundNo={revealSummary.roundNo}
              reveal={revealSummary.entries}
              players={players}
              note={revealSummary.note}
            />
          </div>
        ) : null}

        <div className="lg:col-start-2">
          <EventsPanel entries={logEntries} />
        </div>
      </div>

      {/* 開盅覆蓋：可由關閉鈕提前收起，或停留後自動關閉並留下摘要條 */}
      {revealView ? (
        <RevealPanel
          roundNo={revealView.roundNo}
          reveal={revealView.entries}
          players={players}
          note={revealView.note}
          onClose={closeRevealNow}
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
