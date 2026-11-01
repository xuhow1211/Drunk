/**
 * 我手邊有什麼（核心比對模式）。
 *
 * 左欄選擇手邊材料，右欄即時算出只差最少材料的調酒推薦。
 */
import { useMemo, useState } from 'react';
import { matchRecipes } from '../lib/matching';
import { useCocktails } from '../hooks/useCocktails';
import { useOwnedIngredients } from '../hooks/useOwnedIngredients';
import { IngredientPicker } from '../components/IngredientPicker';
import { MatchPanel } from '../components/MatchPanel';
import type { MatchSort } from '../components/MatchPanel';
import { Reveal } from '../components/Reveal';

/**
 * 核心比對模式頁面。
 */
export function Match() {
  const { recipes } = useCocktails();
  const { owned, count } = useOwnedIngredients();
  const [sort, setSort] = useState<MatchSort>('closest');

  // 每次勾選變化都重新計算比對結果。
  // 裝飾（橙皮、橄欖、櫻桃等）不影響能不能調出來，因此不列入缺料計算：
  // 否則手邊有「伏特加＋柳橙汁」時，螺絲起子會因為少了柳橙皮而被標成缺一樣，
  // 使用者會誤以為這杯調不成。
  const results = useMemo(
    () => matchRecipes(recipes, owned, { includeGarnish: false }),
    [recipes, owned],
  );

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
      <Reveal>
        <header className="mb-6">
          <h1 className="font-display text-3xl font-black tracking-tight text-ink sm:text-4xl">
            我手邊有什麼
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
            勾選手邊有的材料，缺基酒扣分最重、缺飲料最輕，並一併給你替代方案。
          </p>
        </header>
      </Reveal>

      {/* 左欄固定高度（扣除頁首與說明文字的高度），確保操作列永遠在畫面內 */}
      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="min-w-0 lg:sticky lg:top-20 lg:h-[calc(100dvh-13rem)]">
          <IngredientPicker />
        </div>

        <MatchPanel
          results={results}
          ownedCount={count}
          totalCount={recipes.length}
          sort={sort}
          onSortChange={setSort}
        />
      </div>
    </div>
  );
}
