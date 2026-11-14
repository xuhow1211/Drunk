/**
 * 配方卡片。
 *
 * 有示意照片的配方以照片為卡片視覺（4:3、懶載入），
 * 無照片者以漸層色票代替（依調酒類型給不同色相），
 * 顯示中英文名、難度與風味標籤，並提供「一鍵加入我的手邊」按鈕。
 */
import { getRequiredIngredientIds } from '../lib/matching';
import {
  FLAVOR_LABELS,
  RECIPE_CATEGORY_LABELS,
  categoryGradient,
} from '../lib/format';
import { useRecipeNav } from '../hooks/useRecipeNav';
import { DifficultyDots, PopularityMark, TagChip } from './Badges';
import { AddToOwnedButton } from './AddToOwnedButton';
import { GlassIcon } from './Icons';
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
 * 整張卡片是一個按鈕（點擊開啟配方詳情），
 * 「加入我的手邊」是另一顆獨立按鈕，因此卡片本身以 article 承載，
 * 避免在 button 內巢狀 button 的無效 HTML。
 *
 * @param props 元件參數
 */
export function RecipeCard({ recipe, delay = 0 }: RecipeCardProps) {
  const openRecipe = useRecipeNav();
  const categoryLabel = RECIPE_CATEGORY_LABELS[recipe.category];

  return (
    <article
      className="panel panel-hover group animate-rise block w-full overflow-hidden text-left"
      style={{ animationDelay: `${delay}ms` }}
    >
      <button
        type="button"
        onClick={() => openRecipe(recipe)}
        data-recipe-id={recipe.id}
        className="block w-full cursor-pointer text-left"
      >
        {recipe.photoUrl ? (
          /* 有實照：4:3 照片為卡片視覺，懶載入降低列表的流量壓力；
             左下角疊放分類小徽章，讓照片卡與色塊卡的資訊一致 */
          <div className="relative overflow-hidden">
            <img
              src={recipe.photoUrl}
              alt={`${recipe.nameZh} 示意照片`}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
            <span className="absolute bottom-2 left-3 flex items-center gap-1.5 rounded-full bg-night-900/70 px-2.5 py-1 text-xs font-semibold text-white/95 backdrop-blur-sm">
              <GlassIcon width={15} height={15} />
              {categoryLabel}
            </span>
          </div>
        ) : (
          /* 無實照：沿用漸層色塊與分類字樣 */
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
        )}

        <div className="p-3 sm:p-4">
          {/* 主資訊：酒名明確醒目 */}
          <h3 className="font-display text-lg font-bold leading-snug text-ink">{recipe.nameZh}</h3>
          {/* 輔助資訊：英文名降級為更小更淡的一行 */}
          <p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-ink-muted/80 sm:text-xs sm:tracking-wide sm:text-ink-muted">
            {recipe.nameEn}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <DifficultyDots level={recipe.difficulty} showLabel />
          </div>

          {recipe.flavor.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recipe.flavor.slice(0, 2).map((flavor) => (
                <TagChip key={flavor} className="border-white/10 bg-white/5">
                  {FLAVOR_LABELS[flavor] ?? flavor}
                </TagChip>
              ))}
            </div>
          ) : null}
        </div>
      </button>

      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <AddToOwnedButton
          className="min-h-[44px] w-full justify-center text-sm"
          materialIds={getRequiredIngredientIds(recipe)}
        />
      </div>
    </article>
  );
}
