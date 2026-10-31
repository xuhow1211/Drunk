/**
 * 首頁。
 *
 * 由主視覺、三大入口、精選熱選橫向捲動與數據帶組成。
 */
import { useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
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
    <div className="pb-10">
      <Hero />

      <EntryCards classicCount={counts.classic} popularCount={counts.popular} />

      {/* 精選熱選 */}
      <section className="mt-16 px-4 sm:px-6 lg:px-10" aria-label="精選熱選">
        <div className="mx-auto max-w-[1440px]">
          <Reveal className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">精選熱選</h2>
              <p className="mt-1 text-sm text-ink-muted">依票選熱門度取前 12 杯，可橫向拖曳瀏覽</p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <TopCarousel recipes={topPicks} />
          </Reveal>
        </div>
      </section>

      {/* 數據帶 */}
      <section className="mt-16 px-4 sm:px-6 lg:px-10" aria-label="資料統計">
        <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="總配方數" value={recipes.length} suffix=" 杯" />
          <StatCard label="總食材數" value={ingredients.length} suffix=" 項" />
          <StatCard label="涵蓋來源數" value={counts.sources} suffix=" 個" />
        </div>
      </section>
    </div>
  );
}

/** 首頁精選熱選的橫向捲動列（可拖曳）。 */
function TopCarousel({ recipes }: { recipes: ReturnType<typeof useCocktails>['recipes'] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0, moved: false });

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

  return (
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
