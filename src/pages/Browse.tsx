/**
 * 瀏覽模式頁面（經典調酒／熱門推薦共用）。
 *
 * 以 prop 傳入不同的配方系列集合，其餘版面與篩選邏輯完全共用。
 */
import { useMemo, useState } from 'react';
import { useCocktails } from '../hooks/useCocktails';
import { FilterBar } from '../components/FilterBar';
import { RecipeGrid } from '../components/RecipeGrid';
import { Reveal } from '../components/Reveal';
import { DEFAULT_FILTERS, collectFacets, filterRecipes, getRecipeCollections, sortRecipes } from '../lib/filters';
import type { FilterState } from '../lib/filters';
import type { Collection } from '../lib/types';

/** BrowsePage 的參數。 */
export interface BrowsePageProps {
  /** 頁面主標。 */
  title: string;
  /** 頁面副標。 */
  subtitle: string;
  /** 本頁要呈現的配方系列。 */
  collections: readonly Collection[];
}

/**
 * 瀏覽模式頁面。
 *
 * @param props 元件參數
 */
export function BrowsePage({ title, subtitle, collections }: BrowsePageProps) {
  const { recipes, ingredients } = useCocktails();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  // 一杯酒可能同時屬於多個系列（例如既是 IBA 經典也是票選熱門），
  // 因此系列範圍以 collections 陣列判斷，不能只看單一 collection。
  const scoped = useMemo(
    () =>
      recipes.filter((recipe) =>
        getRecipeCollections(recipe).some((collection) => collections.includes(collection)),
      ),
    [recipes, collections],
  );

  const facets = useMemo(() => collectFacets(scoped), [scoped]);

  const ingredientNames = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.zh])),
    [ingredients],
  );

  const filtered = useMemo(
    () => filterRecipes(scoped, filters, ingredientNames, { collections }),
    [scoped, filters, ingredientNames, collections],
  );

  const sorted = useMemo(() => sortRecipes(filtered, filters.sort), [filtered, filters.sort]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <Reveal>
        <header className="mb-8">
          <h1 className="font-display text-3xl font-black tracking-tight text-ink sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
            {subtitle}
          </p>
        </header>
      </Reveal>

      <Reveal delay={80}>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          facets={facets}
          resultCount={sorted.length}
        />
      </Reveal>

      <div className="mt-8">
        <RecipeGrid
          recipes={sorted}
          emptyTitle="沒有符合條件的調酒"
          emptyHint="放寬篩選條件，或改用其他關鍵字搜尋看看。"
          emptyActionLabel="清除篩選"
          onEmptyAction={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}
        />
      </div>
    </div>
  );
}
