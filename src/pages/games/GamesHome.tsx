/**
 * /games 遊戲首頁。
 *
 * 三大卡：創建房間（點擊即建房並跳轉大廳）、加入房間（6 碼英數輸入）、
 * 個人戰績（Phase 3 結算功能前的佔位卡，不可點）。
 * 未登入或會員功能未啟用時由 GamesAuthGate 攔下。
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGameRoom, joinGameRoom } from '../../lib/games/roomClient';
import { normalizeRoomInput, validateRoomInput } from '../../lib/games/roomValidate';
import { GamesAuthGate } from './GamesAuthGate';

/** 共用卡樣式（panel，觸控目標加大）。 */
const CARD_CLASS =
  'panel flex min-h-[120px] flex-col items-center justify-center gap-2 p-6 text-center ' +
  'transition hover:border-neon-purple/60';

/** 加入房間輸入框的樣式（大字距便於核對 6 碼房間 ID）。 */
const JOIN_INPUT_CLASS =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-center text-lg ' +
  'font-bold tracking-[0.3em] text-ink placeholder:text-ink-muted/50 ' +
  'focus:border-neon-cyan/70 focus:outline-none';

/** 錯誤訊息樣式（顯示在欄位附近）。 */
const ERROR_CLASS = 'mt-2 text-xs text-neon-pink';

/**
 * 建立房間卡：點擊即以預設設定建房，成功後跳轉大廳。
 */
function CreateRoomCard() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const roomId = await createGameRoom(5, 15);
      navigate(`/games/room/${roomId}`);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '建立房間失敗，請再試一次。');
      setCreating(false);
    }
  };

  return (
    <section className={CARD_CLASS}>
      <h2 className="font-display text-xl font-bold text-ink">創建房間</h2>
      <p className="text-xs text-ink-muted">建立後把 6 碼房間 ID 分享給朋友</p>
      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={creating}
        className="mt-2 min-h-[44px] w-full max-w-[220px] rounded-full border border-neon-purple/60 bg-neon-purple/25 px-5 text-sm font-semibold text-ink transition hover:bg-neon-purple/40 disabled:opacity-50"
      >
        {creating ? '建立中……' : '建立新房間'}
      </button>
      {error ? <p className={ERROR_CLASS} role="alert">{error}</p> : null}
    </section>
  );
}

/**
 * 加入房間卡：6 碼英數輸入（自動大寫、過濾不合法字元）、錯誤訊息在欄位附近。
 */
function JoinRoomCard() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async (event: FormEvent) => {
    event.preventDefault();
    const message = validateRoomInput(roomId);
    if (message) {
      setError(message);
      return;
    }
    setJoining(true);
    setError(null);
    try {
      await joinGameRoom(roomId);
      navigate(`/games/room/${roomId}`);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '加入房間失敗，請再試一次。');
      setJoining(false);
    }
  };

  return (
    <section className={CARD_CLASS}>
      <h2 className="font-display text-xl font-bold text-ink">加入房間</h2>
      <p className="text-xs text-ink-muted">輸入朋友分享的 6 碼房間 ID</p>
      <form onSubmit={(event) => void handleJoin(event)} noValidate className="mt-2 w-full max-w-[240px]">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-label="房間 ID"
          className={JOIN_INPUT_CLASS}
          value={roomId}
          onChange={(event) => {
            setError(null);
            setRoomId(normalizeRoomInput(event.target.value));
          }}
          placeholder="ABC234"
          disabled={joining}
        />
        {error ? <p className={ERROR_CLASS} role="alert">{error}</p> : null}
        <button
          type="submit"
          disabled={joining}
          className="mt-3 min-h-[44px] w-full rounded-full border border-neon-cyan/60 bg-neon-cyan/20 px-5 text-sm font-semibold text-ink transition hover:bg-neon-cyan/35 disabled:opacity-50"
        >
          {joining ? '加入中……' : '加入'}
        </button>
      </form>
    </section>
  );
}

/**
 * 個人戰績卡：Phase 3 前的佔位（不可點）。
 */
function StatsPlaceholderCard() {
  return (
    <section className={`${CARD_CLASS} opacity-60`} aria-disabled="true">
      <h2 className="font-display text-xl font-bold text-ink">個人戰績</h2>
      <p className="text-xs text-ink-muted">結算功能將在稍後開放</p>
    </section>
  );
}

/**
 * /games 遊戲首頁。
 */
export function GamesHome() {
  return (
    <GamesAuthGate>
      <div className="pb-36 pt-10 sm:pb-24">
        <div className="mx-auto max-w-[720px] px-4 sm:px-6">
          <header>
            <h1 className="neon-text font-display text-3xl font-black sm:text-4xl">吹牛骰子</h1>
            <p className="mt-2 text-sm text-ink-muted">
              線上多人吹牛骰子：建立房間或用房間 ID 加入，每人擲骰、喊牌比膽量。
            </p>
          </header>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CreateRoomCard />
            <JoinRoomCard />
            <StatsPlaceholderCard />
          </div>
        </div>
      </div>
    </GamesAuthGate>
  );
}
