/**
 * 配方卡片。
 *
 * 以漸層色票代替照片（依調酒類型給不同色相），
 * 顯示中英文名、分類、難度、酒精度、材料數與熱門標記。
 */
import { getMaterialCount } from '../lib/matching';
import {
  RECIPE_CATEGORY_LABELS,
  categoryAccent,
  categoryGradient,
} from '../lib/format';
import { useRecipeNav } from '../hooks/useRecipeNav';
import { AbvBadge, DifficultyDots, MaterialCountBadge, PopularityMark, TagChip } from './Badges';
import { EyeIcon, GlassIcon } from './Icons';
import type { Recipe } from '../lib/types';

/** RecipeCard 的參數。 */
export interface RecipeCardProps {
  /** 要顯示的配方。 */
  recipe: Recipe;
  /** 進場動畫的延遲（毫秒）。 */
  delay?: number;
}

/**
 * 配方卡片。
 *
 * @param props 元件參數
 */
export function RecipeCard({ recipe, delay = 0 }: RecipeCardProps) {
  const openRecipe = useRecipeNav();
  const materials = getMaterialCount(recipe);
  const categoryLabel = RECIPE_CATEGORY_LABELS[recipe.category] ?? recipe.category;

  return (
    <button
      type="button"
      onClick={() => openRecipe(recipe)}
      data-recipe-id={recipe.id}
      style={{ animationDelay: `${delay}ms` }}
      className="panel panel-hover group block w-full cursor-pointer overflow-hidden text-left animate-rise"
      aria-label={`開啟 ${recipe.nameZh}（${recipe.nameEn}）配方詳情`}
    >
      <div
        className="relative flex h-24 items-end justify-between overflow-hidden px-4 pb-3"
        style={{ background: categoryGradient(recipe.category) }}
      >
        {/* 裝飾用的半透明圓形，模擬酒杯反光 */}
        <span
          aria-hidden="true"
          className="absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/20 blur-md transition-transform duration-500 group-hover:scale-125"
        />
        <span
          aria-hidden="true"
          className="absolute -bottom-12 left-6 h-20 w-20 rounded-full bg-black/25 blur-lg"
        />
        <span className="relative flex items-center gap-1.5 text-xs font-semibold text-white/95">
          <GlassIcon width={15} height={15} />
          {categoryLabel}
        </span>
        <span className="relative">
          <PopularityMark popularity={recipe.popularity} />
        </span>
      </div>

      <div className="p-4">
        <h3 className="font-display text-lg font-bold leading-snug text-ink">{recipe.nameZh}</h3>
        <p className="mt-0.5 truncate text-xs uppercase tracking-wide text-ink-muted">
          {recipe.nameEn}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <DifficultyDots level={recipe.difficulty} showLabel />
          <AbvBadge abv={recipe.abv} />
          <MaterialCountBadge count={materials} />
        </div>

        {recipe.flavor.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recipe.flavor.slice(0, 3).map((flavor) => (
              <TagChip key={flavor} className="border-white/10 bg-white/5">
                {flavor}
              </TagChip>
            ))}
          </div>
        ) : null}

        <span
          className="mt-4 inline-flex items-center gap-1 text-xs font-medium opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ color: categoryAccent(recipe.category) }}
        >
          <EyeIcon width={15} height={15} />
          查看完整配方
        </span>
      </div>
    </button>
  );
}
