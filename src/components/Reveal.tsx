/**
 * 捲動進場動畫容器。
 *
 * 以 IntersectionObserver 偵測元素進入視窗，再套用淡入上移的動畫。
 * 若瀏覽器不支援 IntersectionObserver，則直接顯示內容，不阻擋閱讀。
 * 使用者偏好減少動態（prefers-reduced-motion）時不做位移與淡入，直接顯示最終狀態。
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/** 偵測使用者是否偏好減少動態。 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** 是否為手機寬度（<768px）。與 index.css 收斂 animate-rise 延遲的斷點一致。 */
function isCompactViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px)').matches
  );
}

/** Reveal 元件的參數。 */
export interface RevealProps {
  /** 內容。 */
  children: ReactNode;
  /** 額外的 class 名稱。 */
  className?: string;
  /** 進場延遲（毫秒），用於製造階梯感；手機上會收斂為 0。 */
  delay?: number;
  /** 元素起始位移距離（像素）。 */
  distance?: number;
}

/**
 * 捲動進場動畫容器。
 *
 * 手機（<768px）下階梯延遲一律收斂為 0：手機捲動快、畫面小，
 * 逐項延遲只會讓內容「等出現」，與 index.css 對 animate-rise 的收斂同一理由。
 *
 * @param props 元件參數
 */
export function Reveal({ children, className = '', delay = 0, distance = 26 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 偏好減少動態時，初始即為最終狀態，之後完全不做位移與過場
  const [visible, setVisible] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (visible) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const effectiveDelay = isCompactViewport() ? 0 : delay;
  const style: CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible
      ? 'translate3d(0, 0, 0)'
      : `translate3d(0, ${distance}px, 0)`,
    transition:
      'opacity 620ms cubic-bezier(0.22, 0.9, 0.24, 1), transform 620ms cubic-bezier(0.22, 0.9, 0.24, 1)',
    transitionDelay: `${effectiveDelay}ms`,
    willChange: visible ? 'auto' : 'opacity, transform',
  };

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
