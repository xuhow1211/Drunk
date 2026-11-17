/**
 * 酒吧背景音控制面板。
 *
 * 固定在右下角，三種呈現：
 *   1. 等待互動：瀏覽器擋下自動播放時，先收成右下小喇叭鈕（含微亮角標），
 *      點擊後才展開播放提示卡；不再佔住整片畫面。
 *   2. 播放中（手機，<768px 以下）：收合成單行圖示列——頻道短名加上
 *      播放／暫停、靜音、換台、關閉、收合五顆圖示，寬度上限 40vw，
 *      不遮擋主要操作區；音量滑桿與說明文字只在平板以上出現。
 *   3. 播放中（768px 以上）：兩列面板，含播放暫停、音量、換台與關閉。
 *
 * 手機（<768px）上所有浮層的根定位上移到 TabBar 之上：
 * bottom = tab 高度 56px + 安全區距 + 8px 間距；768px 以上維持原值。
 */
import { useState, type ReactNode } from 'react';
import { useBarMusic } from '../hooks/useBarMusic';
import type { BarMusicController } from '../hooks/useBarMusic';
import {
  ChevronRightIcon,
  CloseIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  ShuffleIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from './Icons';

/** 手機版浮層根定位：TabBar 高度（3.5rem）+ 8px 間距 + 安全區距。 */
const FLOAT_BOTTOM_MOBILE = 'bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-4';

/** 狀態對應的說明文字。 */
function statusLabel(
  status: BarMusicController['status'],
  synthReady: boolean,
): string {
  switch (status) {
    case 'connecting':
      return '連線中';
    case 'playing':
      return '播放中';
    case 'paused':
      return '已暫停';
    case 'offline':
      // 沒有使用者互動時 AudioContext 會停在 suspended，這時必須明確提示
      return synthReady ? '離線模式 · 合成環境音' : '離線模式 · 點一下即可啟動';
    case 'needs-gesture':
      return '等待播放';
    default:
      return '';
  }
}

/**
 * 等待使用者互動的右下小喇叭鈕。
 *
 * 首次進站的初始型態：只是一顆帶微亮角標的小鈕，不遮擋任何內容；
 * 使用者主動點擊後才展開提示卡，不會把瀏覽行為誤判成播放意圖。
 */
function NeedsGestureChip({ onExpand }: { onExpand: () => void }) {
  return (
    <div className={`fixed right-3 z-50 md:right-4 ${FLOAT_BOTTOM_MOBILE}`}>
      <button
        type="button"
        onClick={onExpand}
        aria-label="開啟酒吧背景音提示"
        data-testid="bar-music-gesture-chip"
        className="panel relative flex h-11 w-11 animate-rise items-center justify-center rounded-full border border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan shadow-[0_0_28px_-8px_rgba(34,211,238,0.7)] transition hover:bg-neon-cyan/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan"
      >
        <MusicNoteIcon width={18} height={18} />
        {/* 微亮角標：暗示這顆鈕在等使用者點 */}
        <span
          aria-hidden="true"
          className="animate-pulse-neon absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-neon-cyan/90"
        />
      </button>
    </div>
  );
}

/**
 * 等待使用者互動的提示卡。
 *
 * 由小喇叭鈕點開後呈現：文案只有「開始播放／不要背景音」兩種選擇，
 * 桌機與行動版同一份文案（不再提「點擊任何地方也可以」——該行為已移除）。
 */
function NeedsGestureCard({ music }: { music: BarMusicController }) {
  return (
    <div
      className={`fixed right-3 z-50 w-[min(18rem,calc(100vw-2rem))] md:right-4 ${FLOAT_BOTTOM_MOBILE}`}
    >
      <div className="panel animate-rise border-neon-cyan/50 p-3 shadow-[0_0_44px_-10px_rgba(34,211,238,0.8)] md:p-4">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan animate-pulse-neon"
            aria-hidden="true"
          >
            <MusicNoteIcon width={18} height={18} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-neon-cyan">酒吧背景音</p>
            <p className="truncate text-[11px] text-ink-muted">{music.channel.nameZh}</p>
          </div>
        </div>

        <p className="mt-2 text-xs leading-snug text-ink md:text-sm md:leading-relaxed">
          點一下就開始播放「{music.channel.nameZh}」
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">{music.channel.mood}</p>

        <div className="mt-2.5 flex items-center gap-2 md:mt-3">
          <button
            type="button"
            onClick={music.start}
            data-testid="bar-music-start"
            className="inline-flex items-center gap-1.5 rounded-full border border-neon-cyan/60 bg-neon-cyan/15 px-3 py-1.5 text-xs font-semibold text-neon-cyan transition hover:bg-neon-cyan/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan md:px-4 md:py-2 md:text-sm"
          >
            <PlayIcon width={15} height={15} />
            開始播放
          </button>
          <button
            type="button"
            onClick={music.dismiss}
            className="rounded-full px-2 py-1.5 text-xs text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan md:px-3"
          >
            不要背景音
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 統一的圖示按鈕。
 *
 * 手機 24px、768px 以上 32px，圓形外框與共通焦點樣式集中在此，
 * 各按鈕只附上自己的配色 class。
 * 手機視覺雖為 24px，但以負向外距把實際命中區擴到約 36px（40vw 的
 * 單行上限與 44px 觸控目標衝突，採折衷；完整 44px 以上的觸控目標
 * 為 Nav 與主要按鈕）。
 */
function IconButton({
  label,
  testId,
  onClick,
  pressed,
  className = '',
  children,
}: {
  /** 無障礙名稱（必填，圖示按鈕沒有可見文字）。 */
  label: string;
  /** 測試用 data-testid。 */
  testId: string;
  /** 點擊行為。 */
  onClick: () => void;
  /** 切換狀態按鈕的 aria-pressed；未提供時不輸出屬性。 */
  pressed?: boolean;
  /** 顏色與定位的附加 class。 */
  className?: string;
  /** 圖示內容。 */
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition before:absolute before:-inset-1.5 before:content-[''] before:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan md:h-8 md:w-8 ${className}`}
    >
      {children}
    </button>
  );
}

/** 頻道名稱與狀態列。手機空間僅容納圖示列，名稱與狀態改由螢幕閱讀器與桌面版讀出。 */
function ChannelInfo({ music, isPlaying }: { music: BarMusicController; isPlaying: boolean }) {
  return (
    <div className="order-1 flex min-w-0 flex-1 items-center gap-2">
      <span
        className={[
          'hidden h-8 w-8 shrink-0 items-center justify-center rounded-full md:flex',
          'border border-neon-purple/40 bg-neon-purple/15 text-neon-purple',
          isPlaying ? 'animate-pulse-neon' : '',
        ].join(' ')}
        aria-hidden="true"
      >
        <MusicNoteIcon width={16} height={16} />
      </span>
      <div className="min-w-0">
        {/* 手機版名稱不出現（空間只夠五顆圖示），但仍在 DOM 供測試與輔助技術 */}
        <p
          className="hidden truncate text-[10px] font-semibold text-ink md:block md:text-xs"
          title={music.channel.nameZh}
        >
          {music.channel.nameZh}
        </p>
        {/* 手機版以 sr-only 保留狀態文字，讓測試與輔助技術讀得到「離線模式」語意 */}
        <p className="sr-only truncate text-[11px] text-ink-muted md:not-sr-only">
          {statusLabel(music.status, music.synthReady)}
        </p>
      </div>
    </div>
  );
}

/**
 * 收合時的展開鈕。
 *
 * 把面板收成一顆圓形小鈕停靠在角落，點擊即展開回完整面板；
 * 收合狀態為單次瀏覽期間有效（重新整理回到展開）。
 * 注意：定位（fixed）與面板樣式（panel）必須分層，panel 內含的
 * position 會蓋掉 fixed，導致小鈕掉出定位。
 */
function CollapsedChip({ onExpand }: { onExpand: () => void }) {
  return (
    <div className={`fixed right-3 z-50 md:right-4 ${FLOAT_BOTTOM_MOBILE}`}>
      <button
        type="button"
        onClick={onExpand}
        aria-label="展開酒吧背景音面板"
        data-testid="bar-music-expand"
        className="panel flex h-11 w-11 animate-rise items-center justify-center rounded-full border border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan shadow-[0_0_28px_-8px_rgba(34,211,238,0.7)] transition hover:bg-neon-cyan/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan"
      >
        <MusicNoteIcon width={18} height={18} />
      </button>
    </div>
  );
}

/**
 * 播放中的面板。
 *
 * 單一 flex-wrap 容器搭配 order 與全寬分隔線，同時滿足兩種版型，
 * 避免兩套按鈕造成重複的 data-testid：
 *   - 手機（768px 以下）：單行圖示列（播放／靜音／換台／關閉／收合五顆，
 *     寬度上限 40vw，約 44px 高），頻道名稱不占畫面；
 *     不出現音量滑桿（擇簡單者：手機無滑桿，音量以靜音鍵與桌機調整）。
 *   - 768px 以上：保留原本兩列版型（頻道／換台／關閉，下一列播放／靜音／音量）。
 * 面板右上另有收合鈕：收成角落小鈕後音源不間斷，點擊小鈕即可展開。
 */
function MusicPanel({
  music,
  onCollapse,
}: {
  music: BarMusicController;
  onCollapse: () => void;
}) {
  /** 音源實際有在出聲（離線模式下合成音未啟動時視同未播放，鈕面顯示播放） */
  const audible =
    music.status === 'playing' || (music.status === 'offline' && music.synthReady);
  const slider = (
    <div className="hidden min-w-0 md:order-7 md:block md:flex-1">
      <label className="sr-only" htmlFor="bar-music-volume">
        背景音音量
      </label>
      <input
        id="bar-music-volume"
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(music.volume * 100)}
        onChange={(event) => music.changeVolume(Number(event.target.value) / 100)}
        data-testid="bar-music-volume"
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-neon-cyan"
      />
    </div>
  );

  return (
    <div className={`fixed right-3 z-50 md:right-4 ${FLOAT_BOTTOM_MOBILE}`}>
      <div
        className="panel animate-rise flex w-max max-w-[40vw] flex-wrap items-center gap-x-0.5 gap-y-1 px-1.5 py-1.5 md:w-[19rem] md:max-w-none md:gap-x-2.5 md:px-3 md:py-2.5"
        role="region"
        aria-label="酒吧背景音"
        data-testid="bar-music-panel"
      >
        <ChannelInfo music={music} isPlaying={audible} />

        <IconButton
          label="隨機換一個頻道"
          testId="bar-music-shuffle"
          onClick={music.playAnother}
          className="order-4 border border-white/15 bg-white/5 text-ink hover:bg-white/12 md:order-2"
        >
          <ShuffleIcon width={15} height={15} />
        </IconButton>

        <IconButton
          label="收合背景音面板"
          testId="bar-music-collapse"
          onClick={onCollapse}
          className="order-6 border border-white/10 text-ink-muted hover:text-ink md:order-4"
        >
          <ChevronRightIcon width={14} height={14} />
        </IconButton>

        <IconButton
          label="關閉背景音"
          testId="bar-music-close"
          onClick={music.dismiss}
          className="order-5 border border-white/10 text-ink-muted hover:text-ink md:order-3"
        >
          <CloseIcon width={14} height={14} />
        </IconButton>

        {/* 全寬分隔線只在 sm 以上出現：把手機的單行切成桌機的兩列 */}
        <span aria-hidden="true" className="order-4 hidden h-px w-full bg-white/10 md:block" />

        <IconButton
          label={audible ? '暫停背景音' : '播放背景音'}
          testId="bar-music-toggle"
          onClick={music.toggle}
          pressed={audible}
          className="order-2 border border-neon-cyan/45 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 md:order-5"
        >
          {audible ? <PauseIcon width={15} height={15} /> : <PlayIcon width={15} height={15} />}
        </IconButton>

        <IconButton
          label={music.isMuted ? '取消靜音' : '靜音'}
          testId="bar-music-mute"
          onClick={music.toggleMute}
          pressed={music.isMuted}
          className="order-3 border border-white/15 bg-white/5 text-ink hover:bg-white/12 md:order-6"
        >
          {music.isMuted ? (
            <VolumeMuteIcon width={15} height={15} />
          ) : (
            <VolumeIcon width={15} height={15} />
          )}
        </IconButton>

        {slider}
      </div>
    </div>
  );
}

/**
 * 酒吧背景音面板。
 */
export function BarMusicPlayer() {
  const music = useBarMusic();
  /** 面板是否已收合為角落小鈕（收合時音源持續播放）。 */
  const [collapsed, setCollapsed] = useState(false);
  /** 等待互動的小喇叭鈕是否已被點開成提示卡。 */
  const [gestureOpen, setGestureOpen] = useState(false);

  // 使用者已表示不想聽背景音（含跨訊息的 localStorage 紀錄），就完全不出現
  if (music.status === 'dismissed') return null;

  // 瀏覽器擋下自動播放時，先收成右下小喇叭鈕；使用者點開後才出現提示卡
  if (music.status === 'needs-gesture') {
    return gestureOpen ? (
      <NeedsGestureCard music={music} />
    ) : (
      <NeedsGestureChip onExpand={() => setGestureOpen(true)} />
    );
  }

  if (collapsed) return <CollapsedChip onExpand={() => setCollapsed(false)} />;

  return <MusicPanel music={music} onCollapse={() => setCollapsed(true)} />;
}
