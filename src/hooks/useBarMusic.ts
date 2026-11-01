/**
 * 酒吧背景音的播放控制。
 *
 * 播放路徑有兩條：
 *   1. 主要走線上電台串流，氣質最好。
 *   2. 串流連不上（離線、網路被擋）時，降級為 ambientSynth 的合成環境音。
 *
 * 瀏覽器規定未經使用者互動不得自動播放有聲音的媒體，因此進站時會先
 * 嘗試 play()；被政策擋下時切到 needs-gesture 狀態，等使用者點擊。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BAR_MUSIC_CHANNEL_STORAGE_KEY,
  BAR_MUSIC_DISMISSED_STORAGE_KEY,
  BAR_MUSIC_VOLUME_STORAGE_KEY,
  DEFAULT_BAR_MUSIC_VOLUME,
  clampVolume,
  findChannelById,
  pickRandomChannel,
} from '../lib/barMusic';
import { createAmbientSynth } from '../lib/ambientSynth';
import type { AmbientSynth } from '../lib/ambientSynth';
import type { BarMusicChannel } from '../lib/barMusic';

/** 背景音的播放狀態。 */
export type BarMusicStatus =
  /** 正在連線串流。 */
  | 'connecting'
  /** 串流正在播放。 */
  | 'playing'
  /** 使用者暫停。 */
  | 'paused'
  /** 瀏覽器擋下了自動播放，需要使用者點一次。 */
  | 'needs-gesture'
  /** 串流不可用，已降級為合成環境音。 */
  | 'offline'
  /** 使用者主關閉，不再提示。 */
  | 'dismissed';

/** 串流連不上時，等多久改用合成環境音（毫秒）。 */
const FALLBACK_DELAY_MS = 9000;

/** 背景音控制介面。 */
export interface BarMusicController {
  /** 目前狀態。 */
  status: BarMusicStatus;
  /** 目前播放的頻道。 */
  channel: BarMusicChannel;
  /** 音量（0 至 1）。 */
  volume: number;
  /** 是否靜音。 */
  isMuted: boolean;
  /** 開始播放。 */
  start: () => void;
  /** 暫停播放。 */
  pause: () => void;
  /** 播放與暫停互換。 */
  toggle: () => void;
  /** 調整音量。 */
  changeVolume: (volume: number) => void;
  /** 靜音與取消靜音互換。 */
  toggleMute: () => void;
  /** 隨機換一個頻道。 */
  playAnother: () => void;
  /** 完全關閉背景音。 */
  dismiss: () => void;
}

/** 從 localStorage 讀回使用者調整過的音量。 */
function readStoredVolume(): number {
  try {
    const raw = window.localStorage.getItem(BAR_MUSIC_VOLUME_STORAGE_KEY);
    if (!raw) return DEFAULT_BAR_MUSIC_VOLUME;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'number') return DEFAULT_BAR_MUSIC_VOLUME;
    return clampVolume(parsed);
  } catch {
    return DEFAULT_BAR_MUSIC_VOLUME;
  }
}

/** 讀出本次分頁要使用的頻道；沒有記錄就隨機挑一個。 */
function resolveInitialChannel(): BarMusicChannel {
  try {
    const stored = window.sessionStorage.getItem(BAR_MUSIC_CHANNEL_STORAGE_KEY);
    const found = findChannelById(stored);
    if (found) return found;
  } catch {
    // sessionStorage 不可用時直接隨機挑選即可
  }
  return pickRandomChannel();
}

/** 使用者是否已經表示不想聽背景音。 */
function isDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(BAR_MUSIC_DISMISSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 判斷播放失敗是否來自瀏覽器的自動播放政策。
 *
 * 只有這一種失敗需要請使用者點一下；
 * 其他失敗（連不上伺服器、媒體格式不支援）代表串流本身不可用，
 * 應該降級為合成環境音而不是一直等使用者點。
 */
function isAutoplayPolicyError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'NotAllowedError';
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'NotAllowedError'
  );
}

/**
 * 管理首頁的酒吧背景音。
 */
export function useBarMusic(): BarMusicController {
  const [status, setStatus] = useState<BarMusicStatus>(() =>
    isDismissed() ? 'dismissed' : 'connecting',
  );
  const [channel, setChannel] = useState<BarMusicChannel>(resolveInitialChannel);
  const [volume, setVolumeState] = useState<number>(readStoredVolume);
  const [isMuted, setIsMuted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synthRef = useRef<AmbientSynth | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  /** 目前實際使用的音源：串流或合成環境音。 */
  const synthModeRef = useRef(false);

  // 以 ref 保存最新狀態，讓下面的 effect 不必把 status 列入相依陣列。
  // 若直接把 status 放進相依陣列，effect 會因為自己更新 status 而無限重跑。
  const statusRef = useRef<BarMusicStatus>(status);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  statusRef.current = status;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;

  /** 清除降級計時器。 */
  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  /** 關閉串流。 */
  const stopStream = useCallback(() => {
    clearFallbackTimer();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, [clearFallbackTimer]);

  /** 降級為合成環境音。 */
  const fallbackToSynth = useCallback(() => {
    if (disposedRef.current) return;
    stopStream();
    synthModeRef.current = true;

    if (!synthRef.current) {
      synthRef.current = createAmbientSynth();
    }
    synthRef.current.setVolume(isMutedRef.current ? 0 : volumeRef.current);
    void synthRef.current.start().catch(() => {
      // 合成音也開不起來（例如環境不支援 Web Audio）就維持離線模式
    });
    setStatus('offline');
  }, [stopStream]);

  /** 掛載時建立音訊元素。 */
  useEffect(() => {
    disposedRef.current = false;
    const audio = new Audio();
    audio.preload = 'none';
    audio.loop = true;
    audio.volume = isMutedRef.current ? 0 : volumeRef.current;
    audioRef.current = audio;

    const handlePlaying = () => {
      clearFallbackTimer();
      setStatus('playing');
    };
    const handleWaiting = () => setStatus('connecting');
    const handleError = () => fallbackToSynth();

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('error', handleError);

    return () => {
      disposedRef.current = true;
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('error', handleError);
      stopStream();
      synthRef.current?.stop();
      synthRef.current = null;
    };
  }, [clearFallbackTimer, fallbackToSynth, stopStream]);

  /**
   * 頻道變更時切換音源並重新播放。
   *
   * 相依陣列只有 channel：狀態更新不應該重新觸發這個 effect，
   * 否則會陷入「設定狀態 → 重新執行 effect → 再設定狀態」的迴圈。
   */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      window.sessionStorage.setItem(BAR_MUSIC_CHANNEL_STORAGE_KEY, channel.id);
    } catch {
      // 無法記錄時不影響播放
    }

    // 已降級為合成音時改頻道沒有意義，先維持合成音播放
    if (synthModeRef.current) return;
    // 使用者已關閉背景音時不再自動播放
    if (statusRef.current === 'dismissed') return;

    audio.src = channel.streamUrl;

    // 使用者已暫停時只換來源，不自動恢復播放
    if (statusRef.current === 'paused') return;

    setStatus('connecting');

    const attempt = audio.play();
    if (attempt) {
      attempt
        .then(() => {
          if (!disposedRef.current) setStatus('playing');
        })
        .catch((error: unknown) => {
          if (disposedRef.current) return;
          // 只有被自動播放政策擋下才需要使用者點一次；
          // 其他失敗（連不上、格式不支援）代表串流不可用，該降級為合成環境音。
          if (isAutoplayPolicyError(error)) {
            setStatus('needs-gesture');
          } else {
            fallbackToSynth();
          }
        });
    }

    // 串流連不上時降級為合成環境音
    fallbackTimerRef.current = window.setTimeout(() => {
      fallbackTimerRef.current = null;
      fallbackToSynth();
    }, FALLBACK_DELAY_MS);

    return clearFallbackTimer;
  }, [channel, clearFallbackTimer, fallbackToSynth]);

  /** 音量變更套用到當下的播放來源。 */
  useEffect(() => {
    const effective = isMuted ? 0 : volume;
    const audio = audioRef.current;
    if (audio) audio.volume = effective;
    synthRef.current?.setVolume(effective);

    try {
      window.localStorage.setItem(
        BAR_MUSIC_VOLUME_STORAGE_KEY,
        JSON.stringify(volume),
      );
    } catch {
      // 無法寫入時不影響播放
    }
  }, [volume, isMuted]);

  const start = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // 已經降級為合成音，直接重新啟動合成音
    if (synthModeRef.current) {
      void synthRef.current?.start();
      setStatus('offline');
      return;
    }

    setStatus('connecting');
    const attempt = audio.play();
    if (attempt) {
      attempt
        .then(() => {
          if (!disposedRef.current) setStatus('playing');
        })
        .catch((error: unknown) => {
          if (disposedRef.current) return;
          if (isAutoplayPolicyError(error)) {
            setStatus('needs-gesture');
          } else {
            fallbackToSynth();
          }
        });
    }
  }, [fallbackToSynth]);

  const pause = useCallback(() => {
    if (!synthModeRef.current) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        setStatus('paused');
        return;
      }
    }
    synthRef.current?.stop();
    setStatus('paused');
  }, []);

  const toggle = useCallback(() => {
    const current = statusRef.current;
    // 離線模式下合成環境音同樣算「正在播放」，暫停鈕要能停掉它
    if (current === 'playing' || current === 'offline') {
      pause();
      return;
    }
    start();
  }, [pause, start]);

  const changeVolume = useCallback((next: number) => {
    setVolumeState(clampVolume(next));
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((previous) => !previous);
  }, []);

  const playAnother = useCallback(() => {
    setChannel((previous) => pickRandomChannel(Math.random, previous.id));
  }, []);

  const dismiss = useCallback(() => {
    stopStream();
    synthRef.current?.stop();
    try {
      window.sessionStorage.setItem(BAR_MUSIC_DISMISSED_STORAGE_KEY, '1');
    } catch {
      // 無法記錄時不影響本次關閉
    }
    setStatus('dismissed');
  }, [stopStream]);

  return {
    status,
    channel,
    volume,
    isMuted,
    start,
    pause,
    toggle,
    changeVolume,
    toggleMute,
    playAnother,
    dismiss,
  };
}
