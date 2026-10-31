/**
 * 清單重新排序的位移動畫（FLIP 手法）。
 *
 * 原理：先量測上一次繪製後每個項目的位置，下次排序改變後再量測新位置，
 * 以 transform 把項目從舊位置平移回新位置，動畫結束後歸零。
 *
 * 全程只改變 transform，不會觸發版面重排。
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * 建立清單項目的節點註冊函式，並在順序改變時播放位移動畫。
 *
 * @param keys 目前清單的鍵值順序
 */
export function useFlipList(keys: readonly string[]) {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const positionsRef = useRef(new Map<string, number>());
  const orderKey = keys.join('|');

  /** 註冊（或取消註冊）某個清單項目的 DOM 節點。 */
  const register = useCallback((id: string, node: HTMLElement | null) => {
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const nodes = nodesRef.current;
    const previous = positionsRef.current;

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const canAnimate =
      !reduceMotion && typeof Element.prototype.animate === 'function';

    if (canAnimate && previous.size > 0) {
      for (const [id, node] of nodes) {
        const before = previous.get(id);
        if (before === undefined) continue;
        const after = node.getBoundingClientRect().top + window.scrollY;
        const delta = before - after;
        if (Math.abs(delta) < 1) continue;
        node.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
          { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        );
      }
    }

    const next = new Map<string, number>();
    for (const [id, node] of nodes) {
      next.set(id, node.getBoundingClientRect().top + window.scrollY);
    }
    positionsRef.current = next;
  }, [orderKey]);

  return register;
}
