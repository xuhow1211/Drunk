/**
 * 數字翻牌遞增計數。
 *
 * 元素進入視窗後由 requestAnimationFrame 驅動數值遞增，
 * 以 easeOutCubic 曲線收尾，讓數字有「跳上去」的感覺。
 */
import { useEffect, useRef, useState } from 'react';

/** CountUp 元件的參數。 */
export interface CountUpProps {
  /** 目標數值。 */
  value: number;
  /** 遞增動畫長度（毫秒）。 */
  duration?: number;
  /** 數字後綴字樣。 */
  suffix?: string;
  /** 數字前綴字樣。 */
  prefix?: string;
  /** 數字本身的 class 名稱。 */
  className?: string;
}

/** easeOutCubic 緩動函式。 */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * 數字翻牌遞增計數。
 *
 * 預設 600ms：原本 1400ms 在手機快速滑過時，使用者往往只看到起點的 0
 * 就已滑出視窗；縮短之後即使一掃而過也能看到接近最終值的數字。
 *
 * @param props 元件參數
 */
export function CountUp({ value, duration = 600, suffix = '', prefix = '', className = '' }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const startedRef = useRef(false);
  /** 目前顯示的值；用於在數值變動時從現況往上累加，而不是跳回 0。 */
  const displayRef = useRef(0);

  /** 更新顯示值並同步 ref。 */
  const updateDisplay = (next: number) => {
    displayRef.current = next;
    setDisplay(next);
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    // 每次 value 變動都重新允許一次遞增動畫；
    // 少了這行，observer 的回呼會因為 startedRef 已是 true 而直接略過，
    // 數字就會永久停在舊值。
    startedRef.current = false;

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      updateDisplay(value);
      return undefined;
    }

    if (typeof IntersectionObserver === 'undefined') {
      updateDisplay(value);
      return undefined;
    }

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || startedRef.current) continue;
          startedRef.current = true;
          observer.disconnect();

          const start = performance.now();
          // 從目前顯示值遞增到新值，避免數字變動時閃爍回 0
          const from = displayRef.current;
          const step = (now: number) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = easeOutCubic(progress);
            updateDisplay(Math.round(from + (value - from) * eased));
            if (progress < 1) frame = requestAnimationFrame(step);
          };
          frame = requestAnimationFrame(step);
        }
      },
      // 0.1：元素剛露出一角就開始播，手機快速滑過也能看到計數而非停留在 0
      { threshold: 0.1 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display.toLocaleString('zh-Hant')}
      {suffix}
    </span>
  );
}
