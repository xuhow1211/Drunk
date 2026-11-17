/**
 * 首頁。
 *
 * 由主視覺、三大入口、精選熱選橫向捲動與數據帶組成。
 * 手機版收緊各段留白：主視覺之後緊接三大入口（手機上入口卡就是主功能），
 * 精選熱選與數據帶依序下移。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useCocktails } from '../hooks/useCocktails';
import { getRecipeCollections } from '../lib/filters';
import { CountUp } from '../components/CountUp';
import { EntryCards } from '../components/EntryCards';
import { Hero } from '../components/Hero';
import { RecipeCard } from '../components/RecipeCard';
import { Reveal } from '../components/Reveal';

/**
 * 首頁。
 */
export function Home() {
  const { recipes, ingredients } = useCocktails();

  const counts = useMemo(() => {
    let classic = 0;
    let popular = 0;
    const sources = new Set<string>();
    for (const recipe of recipes) {
      // 一杯酒可能同時屬於多個系列，杯數須依 collections 陣列累計
      const collections = getRecipeCollections(recipe);
      if (collections.includes('classic') || collections.includes('new-era')) classic += 1;
      if (collections.includes('popular')) popular += 1;
      sources.add(recipe.sourceSite ?? '其他');
    }
    return { classic, popular, sources: sources.size };
  }, [recipes]);

  const topPicks = useMemo(
    () =>
      [...recipes]
        .sort((a, b) => b.popularity - a.popularity || a.nameZh.localeCompare(b.nameZh, 'zh-Hant'))
        .slice(0, 12),
    [recipes],
  );

  return (
    // 底部留白要避開右下角浮動的背景音面板，否則最後一排內容會被蓋住
    <div className="pb-36 sm:pb-24">
      <Hero />

      <EntryCards classicCount={counts.classic} popularCount={counts.popular} />

      {/* 超商調酒直達：批次一的三張入口卡不動，另以小型連結通往 /easy */}
      <div className="mt-3 flex justify-center px-4 sm:justify-start">
        {/* 44px 觸控目標＋14px 字級：手機上這顆連結是主要入口之一 */}
        <Link
          to="/easy"
          className="inline-flex min-h-[44px] items-center rounded-full border border-neon-cyan/35 bg-neon-cyan/10 px-4 py-2 text-sm font-semibold text-neon-cyan transition hover:bg-neon-cyan/20"
        >
          超商調酒專區 →
        </Link>
      </div>

      {/* 精選熱選（手機版與上段留白收緊，桌機維持原段距） */}
      <section className="mt-10 px-4 sm:mt-16 sm:px-6 lg:px-10" aria-label="精選熱選">
        <div className="mx-auto max-w-[1440px]">
          <Reveal className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">精選熱選</h2>
              <p className="mt-1 text-xs text-ink-muted sm:text-sm">
                依票選熱門度取前 12 杯，可左右滑動瀏覽
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <TopCarousel recipes={topPicks} />
          </Reveal>
        </div>
      </section>

      {/* 數據帶 */}
      <section className="mt-10 px-4 sm:mt-16 sm:px-6 lg:px-10" aria-label="資料統計">
        <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="總配方數" value={recipes.length} suffix=" 杯" />
          <StatCard label="總食材數" value={ingredients.length} suffix=" 項" />
          <StatCard label="涵蓋來源數" value={counts.sources} suffix=" 個" />
        </div>
      </section>
    </div>
  );
}

/** 拖曳捲動的暫存狀態。 */
interface DragState {
  active: boolean;
  startX: number;
  startScroll: number;
  moved: boolean;
}

/**
 * 首頁精選熱選的拖曳行為：按住拖動即橫向捲動，並記錄是否真的有位移。
 *
 * @param scrollerRef 捲動容器
 * @returns 綁到捲動容器的事件處理與拖曳狀態（moved 用來擋掉拖曳後的卡片點擊）
 */
function useDragScroll(scrollerRef: RefObject<HTMLDivElement | null>) {
  const dragRef = useRef<DragState>({ active: false, startX: 0, startScroll: 0, moved: false });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const node = scrollerRef.current;
    if (!node) return;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startScroll: node.scrollLeft,
      moved: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const node = scrollerRef.current;
    if (!node || !dragRef.current.active) return;
    const delta = event.clientX - dragRef.current.startX;
    if (Math.abs(delta) > 4) dragRef.current.moved = true;
    node.scrollLeft = dragRef.current.startScroll - delta;
  };

  const endDrag = () => {
    dragRef.current.active = false;
  };

  return { dragRef, onPointerDown, onPointerMove, endDrag };
}

/** 精選熱選卡片之間的間距（與 gap-4 同步）。 */
const CAROUSEL_GAP_PX = 16;

/**
 * 依捲動位置計算輪播的頁點。
 *
 * 點數以「可捲動寬度除以卡片步距（卡寬＋間距）」無條件進位再加一，
 * 高亮的頁點代表目前最靠近視窗左緣的那組卡片，
 * 讓使用者一眼看出橫向捲動列還有東西沒看。
 * scroll 事件以 requestAnimationFrame 節流，每次捲動最多重算一次。
 *
 * @param scrollerRef 捲動容器
 * @param itemCount 卡片數量（資料變更時重新計量）
 * @returns 頁點總數與目前高亮的頁點索引
 */
function useCarouselDots(scrollerRef: RefObject<HTMLDivElement | null>, itemCount: number) {
  const [pageCount, setPageCount] = useState(0);
  const [activePage, setActivePage] = useState(0);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return undefined;

    let frame = 0;
    const update = () => {
      const first = node.firstElementChild as HTMLElement | null;
      const step = first ? first.offsetWidth + CAROUSEL_GAP_PX : 1;
      const maxScroll = node.scrollWidth - node.clientWidth;
      if (maxScroll <= 0 || step <= 0) {
        setPageCount(0);
        return;
      }
      const count = Math.ceil(maxScroll / step) + 1;
      setPageCount(count);
      setActivePage(Math.min(count - 1, Math.round(node.scrollLeft / step)));
    };
    // scroll 事件以 rAF 節流（防抖）：連續捲動時每幀最多重算一次
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('resize', onScroll);
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onScroll);
      node.removeEventListener('scroll', onScroll);
    };
  }, [scrollerRef, itemCount]);

  return { pageCount, activePage };
}

/** 首頁精選熱選的橫向捲動列（可拖曳，手機版右緣以漸層與頁點提示可滑動）。 */
function TopCarousel({ recipes }: { recipes: ReturnType<typeof useCocktails>['recipes'] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { dragRef, onPointerDown, onPointerMove, endDrag } = useDragScroll(scrollerRef);
  const { pageCount, activePage } = useCarouselDots(scrollerRef, recipes.length);

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={(event) => {
          // 拖曳後不要誤觸發卡片的點擊
          if (dragRef.current.moved) {
            event.preventDefault();
            event.stopPropagation();
            dragRef.current.moved = false;
          }
        }}
        className="no-scrollbar drag-scroll flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3"
        role="list"
        aria-label="精選熱選調酒"
      >
        {recipes.map((recipe, index) => (
          <div
            key={recipe.id}
            role="listitem"
            className="w-[248px] shrink-0 snap-start sm:w-[272px]"
          >
            <RecipeCard recipe={recipe} delay={Math.min(index * 60, 360)} />
          </div>
        ))}
      </div>

      {/* 手機版右緣漸層淡出（加寬加強），提示還有下一張卡可以滑動 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-night-900 via-night-900/60 to-transparent sm:hidden"
      />

      {/* 頁點：高亮位置依捲動進度變化，補強「可以滑」的暗示 */}
      {pageCount > 1 ? (
        <div className="mt-1 flex items-center justify-center gap-1.5" aria-hidden="true">
          {Array.from({ length: pageCount }, (_, page) => (
            <span
              key={page}
              className={
                page === activePage
                  ? 'h-1.5 w-4 rounded-full bg-neon-purple transition-colors duration-300'
                  : 'h-1.5 w-1.5 rounded-full bg-white/20 transition-colors duration-300'
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 數據帶的單一數字卡。 */
function StatCard({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-7 text-center">
      <p className="neon-text font-display text-4xl font-black tabular-nums sm:text-5xl">
        <CountUp value={value} suffix={suffix} />
      </p>
      <p className="mt-2 text-sm tracking-wide text-ink-muted">{label}</p>
    </div>
  );
}
