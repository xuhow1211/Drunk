/**
 * 酒吧頻道設定的單元測試。
 */
import { describe, expect, it } from 'vitest';
import {
  BAR_MUSIC_CHANNELS,
  DEFAULT_BAR_MUSIC_VOLUME,
  clampVolume,
  findChannelById,
  pickRandomChannel,
} from './barMusic';

describe('酒吧頻道清單', () => {
  it('頻道 id 不重複', () => {
    const ids = BAR_MUSIC_CHANNELS.map((channel) => channel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每個頻道都有中文名稱、風格描述與 https 串流網址', () => {
    for (const channel of BAR_MUSIC_CHANNELS) {
      expect(channel.nameZh.trim(), `${channel.id} 缺中文名`).not.toBe('');
      expect(channel.mood.trim(), `${channel.id} 缺風格描述`).not.toBe('');
      expect(channel.streamUrl, `${channel.id} 不是 https 網址`).toMatch(/^https:\/\//);
    }
  });

  it('頻道數量足夠讓隨機挑選有變化', () => {
    expect(BAR_MUSIC_CHANNELS.length).toBeGreaterThanOrEqual(5);
  });
});

describe('隨機挑選頻道', () => {
  it('依注入的亂數值挑出對應頻道，結果可重現', () => {
    const first = pickRandomChannel(() => 0);
    const last = pickRandomChannel(() => 0.999999);

    expect(first.id).toBe(BAR_MUSIC_CHANNELS[0]?.id);
    expect(last.id).toBe(BAR_MUSIC_CHANNELS[BAR_MUSIC_CHANNELS.length - 1]?.id);
  });

  it('排除指定的頻道，不會挑到同一台', () => {
    const excluded = BAR_MUSIC_CHANNELS[2]!;
    for (const value of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickRandomChannel(() => value, excluded.id).id).not.toBe(excluded.id);
    }
  });

  it('排除不存在的頻道時仍能正常挑選', () => {
    const picked = pickRandomChannel(() => 0.5, 'not-a-real-channel');
    expect(BAR_MUSIC_CHANNELS.some((channel) => channel.id === picked.id)).toBe(true);
  });

  it('亂數超出範圍時不會越界', () => {
    const picked = pickRandomChannel(() => 1.5);
    expect(BAR_MUSIC_CHANNELS.some((channel) => channel.id === picked.id)).toBe(true);
  });
});

describe('依 id 找出頻道', () => {
  it('找得到時回傳該頻道', () => {
    const target = BAR_MUSIC_CHANNELS[1]!;
    expect(findChannelById(target.id)).toEqual(target);
  });

  it('id 不存在或為空時回傳 null', () => {
    expect(findChannelById('nope')).toBeNull();
    expect(findChannelById('')).toBeNull();
    expect(findChannelById(null)).toBeNull();
    expect(findChannelById(undefined)).toBeNull();
  });
});

describe('音量限制', () => {
  it('把數值限制在 0 至 1 之間', () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
    expect(clampVolume(3)).toBe(1);
  });

  it('非有限值退回預設音量', () => {
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_BAR_MUSIC_VOLUME);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_BAR_MUSIC_VOLUME);
  });
});
