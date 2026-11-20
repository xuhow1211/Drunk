/**
 * 房間輸入與設定驗證的單元測試。
 *
 * 房間 ID 的字元集必須與 supabase/game-rooms.sql 的 generate_room_id() 一致：
 * 大寫英數、去掉易混淆的 I、L、O、0、1。
 */
import { describe, expect, it } from 'vitest';
import {
  clampInRange,
  DICE_COUNT_RANGE,
  normalizeRoomInput,
  ROOM_ID_LENGTH,
  ROOM_ID_PATTERN,
  TURN_SECONDS_RANGE,
  validateRoomInput,
} from './roomValidate';

describe('房間 ID 輸入正規化', () => {
  it('轉大寫並保留合法字元', () => {
    expect(normalizeRoomInput('abc234')).toBe('ABC234');
  });

  it('移除空白與符號', () => {
    expect(normalizeRoomInput('ab c-2 34')).toBe('ABC234');
  });

  it('截斷到 6 碼', () => {
    expect(normalizeRoomInput('ABCDEFGH')).toBe('ABCDEF');
    expect(normalizeRoomInput(normalizeRoomInput('ABCDEFGH'))).toHaveLength(ROOM_ID_LENGTH);
  });

  it('空字串維持空字串', () => {
    expect(normalizeRoomInput('')).toBe('');
  });
});

describe('房間 ID 驗證', () => {
  it('6 碼合法字元通過', () => {
    expect(validateRoomInput('A2C3E4')).toBeNull();
    expect(validateRoomInput('KMNPQR')).toBeNull();
    expect('A2C3E4'.match(ROOM_ID_PATTERN)).not.toBeNull();
  });

  it('輸入不足 6 碼回傳提示', () => {
    const message = validateRoomInput('ABC23');
    expect(message).toContain('6 碼');
  });

  it('空輸入回傳提示', () => {
    const message = validateRoomInput('');
    expect(message).toContain('輸入');
  });

  it('含易混淆字元回傳提示（小寫 o 已由大寫化轉成 O，直接驗大寫）', () => {
    expect(validateRoomInput('ABC2O9')).toContain('不支援');
    expect(validateRoomInput('ABC2I9')).toContain('不支援');
    expect(validateRoomInput('ABC2L9')).toContain('不支援');
  });

  it('字元集排除易混淆字元的正規表示式', () => {
    expect(ROOM_ID_PATTERN.test('ABC23O')).toBe(false);
    expect(ROOM_ID_PATTERN.test('ABC230')).toBe(false);
    expect(ROOM_ID_PATTERN.test('ABC231')).toBe(false);
    expect(ROOM_ID_PATTERN.test('ABC23I')).toBe(false);
    expect(ROOM_ID_PATTERN.test('ABC23L')).toBe(false);
    expect(ROOM_ID_PATTERN.test('ABC23K')).toBe(true);
    // SQL 字元集中的每個字元都應該通過正規表示式
    for (const char of 'ABCDEFGHJKMNPQRSTUVWXYZ23456789') {
      expect(ROOM_ID_PATTERN.test(char.repeat(6))).toBe(true);
    }
  });
});

describe('設定範圍夾限', () => {
  it('骰子數範圍為 2 到 5', () => {
    expect(DICE_COUNT_RANGE).toEqual({ min: 2, max: 5 });
  });

  it('思考時間範圍為 5 到 30 秒', () => {
    expect(TURN_SECONDS_RANGE).toEqual({ min: 5, max: 30 });
  });

  it('夾在範圍內的邊界', () => {
    expect(clampInRange(1, DICE_COUNT_RANGE.min, DICE_COUNT_RANGE.max)).toBe(2);
    expect(clampInRange(6, DICE_COUNT_RANGE.min, DICE_COUNT_RANGE.max)).toBe(5);
    expect(clampInRange(4, DICE_COUNT_RANGE.min, DICE_COUNT_RANGE.max)).toBe(4);
    expect(clampInRange(2, TURN_SECONDS_RANGE.min, TURN_SECONDS_RANGE.max)).toBe(5);
    expect(clampInRange(99, TURN_SECONDS_RANGE.min, TURN_SECONDS_RANGE.max)).toBe(30);
  });

  it('非數值退化為最小值', () => {
    expect(clampInRange(Number.NaN, DICE_COUNT_RANGE.min, DICE_COUNT_RANGE.max)).toBe(2);
  });
});
