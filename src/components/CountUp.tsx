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
 * @param props 元件參數
 */
export function CountUp({ value, duration = 1400, suffix = '', prefix = '', className = '' }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      setDisplay(value);
      return undefined;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setDisplay(value);
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
          const step = (now: number) => {
            const progress = Math.min(1, (now - start) / duration);
            setDisplay(Math.round(easeOutCubic(progress) * value));
            if (progress < 1) frame = requestAnimationFrame(step);
          };
          frame = requestAnimationFrame(step);
        }
      },
      { threshold: 0.4 },
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
