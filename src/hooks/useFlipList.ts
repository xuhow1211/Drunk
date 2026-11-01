/**
 * 清單重新排序的位移動畫（FLIP 手法）。
 *
 * 原理：先量測上一次繪製後每個項目的位置，下次排序改變後再量測新位置，
 * 以 transform 把項目從舊位置平移回新位置，動畫結束後歸零。
 *
 * 全程只改變 transform，不會觸發版面重排。
 *
 * 實作要點：
 *   1. 量測與動畫分成兩個 effect。量測的 effect 每次 render 都跑，
 *      因此卡片高度改變（例如缺料行數變動）時，座標不會變成過期資料；
 *      動畫的 effect 只依賴 orderKey，確保只在順序改變時播放。
 *   2. 量測 effect 宣告在動畫 effect 之後，讓動畫 effect 先讀到「改變前」的座標。
 *   3. 播放中的 Animation 物件會被保存並在下次播放前取消，
 *      避免連續切換時多個動畫競爭同一個 transform。
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

/** 動畫的長度與緩動曲線。 */
const ANIMATION_OPTIONS: KeyframeAnimationOptions = {
  duration: 420,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
};

/**
 * 建立清單項目的節點註冊函式，並在順序改變時播放位移動畫。
 *
 * @param keys 目前清單的鍵值順序
 */
export function useFlipList(keys: readonly string[]) {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const positionsRef = useRef(new Map<string, number>());
  const animationsRef = useRef(new Map<string, Animation>());
  const prevOrderKeyRef = useRef<string | null>(null);
  const orderKey = keys.join('|');

  /** 註冊（或取消註冊）某個清單項目的 DOM 節點。 */
  const register = useCallback((id: string, node: HTMLElement | null) => {
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
  }, []);

  /**
   * 動畫 effect：只在順序改變時執行。
   *
   * 讀到的 positionsRef 是上一次 render 量測的結果（改變前的座標），
   * 與目前 DOM 的新座標相減即為位移量。
   */
  useLayoutEffect(() => {
    if (prevOrderKeyRef.current === orderKey) return;
    prevOrderKeyRef.current = orderKey;

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

        // 先取消同一項目上一次尚未結束的動畫，避免兩個動畫競爭同一個 transform
        animationsRef.current.get(id)?.cancel();

        const after = node.getBoundingClientRect().top + window.scrollY;
        const delta = before - after;
        if (Math.abs(delta) < 1) continue;

        const animation = node.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
          ANIMATION_OPTIONS,
        );
        animationsRef.current.set(id, animation);
      }
    }
  }, [orderKey]);

  /**
   * 量測 effect：每次 render 都重新量測各項目的位置。
   *
   * 宣告在動畫 effect 之後，確保動畫 effect 讀到的仍是「改變前」的座標。
   */
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const [id, node] of nodesRef.current) {
      next.set(id, node.getBoundingClientRect().top + window.scrollY);
    }
    positionsRef.current = next;
  });

  /** 元件卸載時取消所有進行中的動畫。 */
  useLayoutEffect(
    () => () => {
      for (const animation of animationsRef.current.values()) animation.cancel();
      animationsRef.current.clear();
    },
    [],
  );

  return register;
}
