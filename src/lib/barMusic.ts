/**
 * 酒吧背景音的頻道設定。
 *
 * 音訊來源為 SomaFM 的免費串流電台（創用 CC 授權，可自由使用）。
 * 挑選原則是氣質要「像酒吧」：間諜爵士、酒廊爵士、私酒館放克與藍調優先，
 * 環境音與慢拍次之。
 *
 * 串流在部分網路環境會連不上，此時由 ambientSynth 的合成環境音接手，
 * 見 useBarMusic。
 */

/** 單一頻道的設定。 */
export interface BarMusicChannel {
  /** 頻道識別碼，用於去除重複與記錄。 */
  id: string;
  /** 中文名稱，顯示在控制面板上。 */
  nameZh: string;
  /** 風格描述。 */
  mood: string;
  /** 串流網址。 */
  streamUrl: string;
}

/** 可隨機挑選的酒吧頻道清單。 */
export const BAR_MUSIC_CHANNELS: readonly BarMusicChannel[] = [
  {
    id: 'secretagent',
    nameZh: '間諜爵士',
    mood: '慵懶的間諜爵士，最有酒吧味',
    streamUrl: 'https://ice1.somafm.com/secretagent-128-mp3',
  },
  {
    id: 'illstreet',
    nameZh: '街角酒廊',
    mood: '老派酒廊爵士，適合獨酌',
    streamUrl: 'https://ice1.somafm.com/illstreet-128-mp3',
  },
  {
    id: 'bootliquor',
    nameZh: '私酒館',
    mood: '低沉放克與藍調，深夜場',
    streamUrl: 'https://ice1.somafm.com/bootliquor-128-mp3',
  },
  {
    id: 'groovesalad',
    nameZh: '慢拍沙拉',
    mood: '輕鬆的慢拍與電子',
    streamUrl: 'https://ice1.somafm.com/groovesalad-128-mp3',
  },
  {
    id: 'u80s',
    nameZh: '地下八十年代',
    mood: '新浪潮與合成器',
    streamUrl: 'https://ice1.somafm.com/u80s-128-mp3',
  },
  {
    id: 'seventies',
    nameZh: '西岸七十年代',
    mood: '七十年代的柔和搖滾',
    streamUrl: 'https://ice1.somafm.com/seventies-128-mp3',
  },
  {
    id: 'dronezone',
    nameZh: '無人地帶',
    mood: '沉浸式環境音，適合長待',
    streamUrl: 'https://ice1.somafm.com/dronezone-128-mp3',
  },
  {
    id: 'deepspaceone',
    nameZh: '深空一號',
    mood: '太空環境音與合成器',
    streamUrl: 'https://ice1.somafm.com/deepspaceone-128-mp3',
  },
  {
    id: 'spacestation',
    nameZh: '太空站',
    mood: '節拍較快的環境音',
    streamUrl: 'https://ice1.somafm.com/spacestation-128-mp3',
  },
  {
    id: 'fluid',
    nameZh: '午夜流動',
    mood: '深沉的律動與節拍',
    streamUrl: 'https://ice1.somafm.com/fluid-128-mp3',
  },
];

/** 預設音量（0 至 1）。酒吧背景音不該蓋過使用者的閱讀，預設壓低。 */
export const DEFAULT_BAR_MUSIC_VOLUME = 0.3;

/** localStorage 鍵名，記住使用者調整過的音量與靜音狀態。 */
export const BAR_MUSIC_VOLUME_STORAGE_KEY = 'join-bar-music-volume';

/** sessionStorage 鍵名，讓同一分頁內回到首頁時接續同一個頻道。 */
export const BAR_MUSIC_CHANNEL_STORAGE_KEY = 'join-bar-music-channel';

/** sessionStorage 鍵名，記住使用者已表示不想聽背景音。 */
export const BAR_MUSIC_DISMISSED_STORAGE_KEY = 'join-bar-music-dismissed';

/**
 * 隨機挑選一個頻道。
 *
 * @param random 亂數來源，預設為 Math.random；測試時可注入固定亂數以得到可重現結果
 * @param excludeId 要排除的頻道 id（用於「換一首」時避免挑到同一台）
 */
export function pickRandomChannel(
  random: () => number = Math.random,
  excludeId?: string,
): BarMusicChannel {
  const candidates = BAR_MUSIC_CHANNELS.filter((channel) => channel.id !== excludeId);
  const pool = candidates.length > 0 ? candidates : BAR_MUSIC_CHANNELS;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index]!;
}

/**
 * 依 id 找出頻道，找不到時回傳 null。
 *
 * sessionStorage 內的頻道 id 可能來自舊版本或被手動改過，
 * 因此一律視為不可信，必須確認後才能使用。
 */
export function findChannelById(id: string | null | undefined): BarMusicChannel | null {
  if (!id) return null;
  return BAR_MUSIC_CHANNELS.find((channel) => channel.id === id) ?? null;
}

/**
 * 把音量數值限制在 0 至 1 之間。
 *
 * 介面上音量滑桿與 localStorage 讀出的值都可能是範圍外的數字，
 * 直接送進音訊元素會被瀏覽器丟出例外。
 */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BAR_MUSIC_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/** 使用者保存下來的音量偏好。 */
export interface BarMusicVolumePreference {
  /** 音量（0 至 1）。 */
  volume: number;
  /** 是否靜音。 */
  muted: boolean;
}

/**
 * 讀取並校正保存的音量偏好。
 *
 * 舊版本只存了音量數字，因此兩種格式都要能讀；
 * 讀不到或格式不符時一律回到預設值。
 */
export function parseVolumePreference(raw: string | null): BarMusicVolumePreference {
  if (!raw) {
    return { volume: DEFAULT_BAR_MUSIC_VOLUME, muted: false };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'number') {
      // 舊格式：只存了音量
      return { volume: clampVolume(parsed), muted: false };
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as { volume?: unknown; muted?: unknown };
      const volume =
        typeof record.volume === 'number'
          ? clampVolume(record.volume)
          : DEFAULT_BAR_MUSIC_VOLUME;
      const muted = record.muted === true;
      return { volume, muted };
    }
  } catch {
    // 格式損毀時退回預設值
  }
  return { volume: DEFAULT_BAR_MUSIC_VOLUME, muted: false };
}
