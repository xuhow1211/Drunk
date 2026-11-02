/**
 * 酒吧背景音控制面板。
 *
 * 固定在右下角，兩種呈現：
 *   1. 等待互動：瀏覽器擋下自動播放時，顯示一張醒目的卡片請使用者點一下。
 *   2. 播放中：收合成一條小工具列，含播放暫停、音量、換台與關閉。
 */
import { useBarMusic } from '../hooks/useBarMusic';
import {
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
  status: ReturnType<typeof useBarMusic>['status'],
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
 * 酒吧背景音面板。
 */
export function BarMusicPlayer() {
  const music = useBarMusic();

  // 使用者已表示不想聽背景音，就完全不出現
  if (music.status === 'dismissed') return null;

  // 瀏覽器擋下自動播放時，用較醒目的卡片請使用者主動點一次
  if (music.status === 'needs-gesture') {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))]">
        <div className="panel animate-rise border-neon-cyan/50 p-4 shadow-[0_0_44px_-10px_rgba(34,211,238,0.8)]">
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

          <p className="mt-2.5 text-sm leading-relaxed text-ink">
            點一下就開始播放「{music.channel.nameZh}」
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {music.channel.mood}。點擊頁面任何地方也會開始。
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={music.start}
              data-testid="bar-music-start"
              className="inline-flex items-center gap-1.5 rounded-full border border-neon-cyan/60 bg-neon-cyan/15 px-4 py-2 text-sm font-semibold text-neon-cyan transition hover:bg-neon-cyan/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan"
            >
              <PlayIcon width={15} height={15} />
              開始播放
            </button>
            <button
              type="button"
              onClick={music.dismiss}
              className="rounded-full px-3 py-2 text-xs text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan"
            >
              不要背景音
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isPlaying = music.status === 'playing' || music.status === 'offline';

  return (
    <div className="fixed bottom-3 right-3 z-50 w-[calc(100vw-1.5rem)] max-w-[18rem] sm:bottom-4 sm:right-4 sm:w-[19rem]">
      <div
        className="panel animate-rise p-2.5 sm:p-3"
        role="region"
        aria-label="酒吧背景音"
        data-testid="bar-music-panel"
      >
        {/* 上列：音符、頻道名稱與次要操作 */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          <span
            className={[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9',
              'border border-neon-purple/40 bg-neon-purple/15 text-neon-purple',
              isPlaying ? 'animate-pulse-neon' : '',
            ].join(' ')}
            aria-hidden="true"
          >
            <MusicNoteIcon width={16} height={16} />
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-ink" title={music.channel.nameZh}>
              {music.channel.nameZh}
            </p>
            <p className="truncate text-[11px] text-ink-muted">
              {statusLabel(music.status, music.synthReady)}
            </p>
          </div>

          <button
            type="button"
            onClick={music.playAnother}
            aria-label="隨機換一個頻道"
            data-testid="bar-music-shuffle"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-ink transition hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan"
          >
            <ShuffleIcon width={15} height={15} />
          </button>

          <button
            type="button"
            onClick={music.dismiss}
            aria-label="關閉背景音"
            data-testid="bar-music-close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>

        {/* 下列：播放、靜音與音量 */}
        <div className="mt-2 flex items-center gap-2 border-t border-white/8 pt-2 sm:mt-2.5 sm:gap-2.5 sm:pt-2.5">
          <button
            type="button"
            onClick={music.toggle}
            aria-label={isPlaying ? '暫停背景音' : '播放背景音'}
            aria-pressed={isPlaying}
            data-testid="bar-music-toggle"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neon-cyan/45 bg-neon-cyan/10 text-neon-cyan transition hover:bg-neon-cyan/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan sm:h-9 sm:w-9"
          >
            {isPlaying ? (
              <PauseIcon width={15} height={15} />
            ) : (
              <PlayIcon width={15} height={15} />
            )}
          </button>

          <button
            type="button"
            onClick={music.toggleMute}
            aria-label={music.isMuted ? '取消靜音' : '靜音'}
            aria-pressed={music.isMuted}
            data-testid="bar-music-mute"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-ink transition hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan sm:h-9 sm:w-9"
          >
            {music.isMuted ? (
              <VolumeMuteIcon width={15} height={15} />
            ) : (
              <VolumeIcon width={15} height={15} />
            )}
          </button>

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
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-neon-cyan"
          />
        </div>
      </div>
    </div>
  );
}
