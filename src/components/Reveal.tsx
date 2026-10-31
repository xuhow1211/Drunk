/**
 * 捲動進場動畫容器。
 *
 * 以 IntersectionObserver 偵測元素進入視窗，再套用淡入上移的動畫。
 * 若瀏覽器不支援 IntersectionObserver，則直接顯示內容，不阻擋閱讀。
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/** Reveal 元件的參數。 */
export interface RevealProps {
  /** 內容。 */
  children: ReactNode;
  /** 額外的 class 名稱。 */
  className?: string;
  /** 進場延遲（毫秒），用於製造階梯感。 */
  delay?: number;
  /** 元素起始位移距離（像素）。 */
  distance?: number;
}

/**
 * 捲動進場動畫容器。
 *
 * @param props 元件參數
 */
export function Reveal({ children, className = '', delay = 0, distance = 26 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

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
  }, []);

  const style: CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translate3d(0, 0, 0)' : `translate3d(0, ${distance}px, 0)`,
    transition:
      'opacity 620ms cubic-bezier(0.22, 0.9, 0.24, 1), transform 620ms cubic-bezier(0.22, 0.9, 0.24, 1)',
    transitionDelay: `${delay}ms`,
    willChange: visible ? 'auto' : 'opacity, transform',
  };

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
