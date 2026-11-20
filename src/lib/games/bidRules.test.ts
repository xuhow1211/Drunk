/**
 * 喊牌規則純函式的單元測試（與 supabase/game-core.sql 同一條件式的前端鏡射）。
 */
import { describe, expect, it } from 'vitest';
import { BID_FACE_RANGE, isValidBid, matchingCount } from './bidRules';

describe('isValidBid：基本值域', () => {
  it('無前喊時，1～6 點的合法喊牌可通過', () => {
    expect(isValidBid(null, 1, 1)).toBe(true);
    expect(isValidBid(null, 3, 4)).toBe(true);
    expect(isValidBid(null, 10, 6)).toBe(true);
  });

  it('數量須為正整數', () => {
    expect(isValidBid(null, 0, 3)).toBe(false);
    expect(isValidBid(null, -1, 3)).toBe(false);
    expect(isValidBid(null, 2.5, 3)).toBe(false);
  });

  it('點數須介於 1 至 6', () => {
    expect(isValidBid(null, 2, 0)).toBe(false);
    expect(isValidBid(null, 2, 7)).toBe(false);
    expect(isValidBid(null, 2, 3.5)).toBe(false);
    expect(Number.isInteger(BID_FACE_RANGE.min)).toBe(true);
  });
});

describe('isValidBid：加碼規則', () => {
  it('數量更多即合法（點數不限）', () => {
    expect(isValidBid({ count: 3, face: 5 }, 4, 1)).toBe(true);
    expect(isValidBid({ count: 3, face: 2 }, 4, 5)).toBe(true);
    expect(isValidBid({ count: 3, face: 5 }, 4, 6)).toBe(true);
  });

  it('數量相同時，點數更高才合法', () => {
    expect(isValidBid({ count: 3, face: 5 }, 3, 6)).toBe(true);
    expect(isValidBid({ count: 3, face: 5 }, 3, 5)).toBe(false);
    expect(isValidBid({ count: 3, face: 5 }, 3, 4)).toBe(false);
    expect(isValidBid({ count: 3, face: 5 }, 3, 1)).toBe(false);
  });

  it('數量更少或相當且點數不升都不合法', () => {
    expect(isValidBid({ count: 4, face: 2 }, 3, 6)).toBe(false);
    expect(isValidBid({ count: 4, face: 2 }, 4, 1)).toBe(false);
  });
});

describe('matchingCount：萬用骰（1 點）', () => {
  it('喊 2～6 點時，同點數與 1 點都計入', () => {
    expect(matchingCount([5, 5, 1], 5)).toBe(3);
    expect(matchingCount([4, 4, 4], 5)).toBe(0);
    expect(matchingCount([2, 3, 4, 5, 1, 1], 2)).toBe(3);
    expect(matchingCount([6, 1, 1, 1], 6)).toBe(4);
  });

  it('喊 1 點時只數 1 點，不再重複（萬用骰不自己加倍）', () => {
    expect(matchingCount([1, 1, 5], 1)).toBe(2);
    expect(matchingCount([2, 3, 4], 1)).toBe(0);
  });

  it('空骰列回 0', () => {
    expect(matchingCount([], 3)).toBe(0);
  });
});
