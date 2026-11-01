/**
 * 「加入我的手邊」按鈕。
 *
 * 分析報告 §3.3 承諾配方卡要提供一鍵加入手邊材料的功能：
 * 點擊後把該杯配方的全部材料加入使用者的手邊清單，
 * 比對結果會即時重算，不必回到左欄一項一項勾選。
 *
 * 互動設計：
 *   - 該杯的材料全部已在手邊時，按鈕顯示「已加入我的材料」並可再次點擊移除。
 *   - 只加入部分材料時，按鈕顯示「加入我的手邊」，點擊補齊缺的那些（既有勾選保留）。
 *   - 點擊後短暫播放一次霓虹脈動，讓使用者確實看到動作生效。
 */
import { useEffect, useRef, useState } from 'react';
import { useOwnedIngredients } from '../hooks/useOwnedIngredients';

/** 脈動動畫的長度（毫秒）。 */
const PULSE_DURATION = 620;

/** AddToOwnedButton 的參數。 */
export interface AddToOwnedButtonProps {
  /** 要加入手邊的材料 id（通常是該杯配方的全部材料）。 */
  materialIds: readonly string[];
  /** 額外的 class 名稱。 */
  className?: string;
}

/**
 * 一鍵加入手邊材料按鈕。
 *
 * @param props 元件參數
 */
export function AddToOwnedButton({ materialIds, className = '' }: AddToOwnedButtonProps) {
  const { isOwned, addMany, removeMany } = useOwnedIngredients();
  const [pulsing, setPulsing] = useState(false);
  const timerRef = useRef(0);

  // 元件卸載時清除計時器，避免對已卸載的元件設定狀態
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const uniqueIds = [...new Set(materialIds)];
  const allOwned = uniqueIds.length > 0 && uniqueIds.every((id) => isOwned(id));

  const handleClick = () => {
    if (allOwned) {
      removeMany(uniqueIds);
    } else {
      addMany(uniqueIds);
    }

    // 重新播放脈動動畫：先取消計時器再重新計時，讓連續點擊也有回饋
    window.clearTimeout(timerRef.current);
    setPulsing(false);
    timerRef.current = window.setTimeout(() => {
      setPulsing(true);
      timerRef.current = window.setTimeout(() => setPulsing(false), PULSE_DURATION);
    }, 0);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={allOwned}
      data-add-to-owned="true"
      className={[
        'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon-cyan',
        allOwned
          ? 'border-neon-green/60 bg-neon-green/15 text-neon-green'
          : 'border-neon-cyan/45 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20',
        pulsing ? 'animate-chip-pop' : '',
        className,
      ].join(' ')}
      title={
        allOwned
          ? '這杯的材料已全部在手邊，點擊可移除'
          : '把這杯的全部材料加入我的手邊清單'
      }
    >
      {allOwned ? '已加入我的材料' : '＋ 加入我的手邊'}
    </button>
  );
}
