/**
 * 酒吧背景音控制面板。
 *
 * 固定在右下角，三種呈現：
 *   1. 等待互動：瀏覽器擋下自動播放時，顯示一張醒目的卡片請使用者點一下。
 *   2. 播放中（手機，<768px 以下）：收合成單行圖示列——頻道短名加上
 *      播放／暫停、靜音、換台、關閉、收合五顆圖示，寬度上限 40vw，
 *      不遮擋主要操作區；音量滑桿與說明文字只在平板以上出現。
 *   3. 播放中（768px 以上）：兩列面板，含播放暫停、音量、換台與關閉。
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
 * 等待使用者互動的提示卡。
 *
 * 手機版收緊：文案精短、兩顆按鈕併列一行，降低對內容的遮擋；
 * 行為語意（開始播放／不要背景音，關閉後本次分頁不再出現）與桌機一致。
 */
function NeedsGestureCard({ music }: { music: BarMusicController }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(18rem,calc(100vw-2rem))]">
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

        {/* 手機版說明壓成一句話，完整說明只出現在桌機 */}
        <p className="mt-2 text-xs leading-snug text-ink md:text-sm md:leading-relaxed">
          <span className="md:hidden">點一下開始播放，點擊任何地方也可以。</span>
          <span className="hidden md:inline">點一下就開始播放「{music.channel.nameZh}」</span>
        </p>
        <p className="mt-1 hidden text-xs text-ink-muted md:block">
          {music.channel.mood}。點擊頁面任何地方也會開始。
        </p>

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
    <div className="fixed bottom-3 right-3 z-50 md:bottom-4 md:right-4">
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
  const isPlaying = music.status === 'playing' || music.status === 'offline';
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
    <div className="fixed bottom-3 right-3 z-50 md:bottom-4 md:right-4">
      <div
        className="panel animate-rise flex w-max max-w-[40vw] flex-wrap items-center gap-x-0.5 gap-y-1 px-1.5 py-1.5 md:w-[19rem] md:max-w-none md:gap-x-2.5 md:px-3 md:py-2.5"
        role="region"
        aria-label="酒吧背景音"
        data-testid="bar-music-panel"
      >
        <ChannelInfo music={music} isPlaying={isPlaying} />

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
          label={isPlaying ? '暫停背景音' : '播放背景音'}
          testId="bar-music-toggle"
          onClick={music.toggle}
          pressed={isPlaying}
          className="order-2 border border-neon-cyan/45 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 md:order-5"
        >
          {isPlaying ? <PauseIcon width={15} height={15} /> : <PlayIcon width={15} height={15} />}
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

  // 使用者已表示不想聽背景音，就完全不出現
  if (music.status === 'dismissed') return null;

  // 瀏覽器擋下自動播放時，用較醒目的卡片請使用者主動點一次
  if (music.status === 'needs-gesture') {
    return <NeedsGestureCard music={music} />;
  }

  if (collapsed) return <CollapsedChip onExpand={() => setCollapsed(false)} />;

  return <MusicPanel music={music} onCollapse={() => setCollapsed(true)} />;
}
