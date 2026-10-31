/**
 * 配方卡片網格。
 *
 * 顯示配方卡片並處理空結果狀態（引導文案與清除篩選按鈕）。
 */
import { RecipeCard } from './RecipeCard';
import type { Recipe } from '../lib/types';

/** RecipeGrid 的參數。 */
export interface RecipeGridProps {
  /** 要顯示的配方。 */
  recipes: readonly Recipe[];
  /** 空結果時的主標。 */
  emptyTitle?: string;
  /** 空結果時的說明。 */
  emptyHint?: string;
  /** 空結果時的按鈕文字。 */
  emptyActionLabel?: string;
  /** 空結果按鈕的點擊事件。 */
  onEmptyAction?: () => void;
  /** 卡片進場的階梯延遲上限（毫秒）。 */
  maxDelay?: number;
}

/**
 * 配方卡片網格。
 *
 * @param props 元件參數
 */
export function RecipeGrid({
  recipes,
  emptyTitle = '沒有符合條件的調酒',
  emptyHint = '試著放寬篩選條件，或用關鍵字搜尋其他酒款。',
  emptyActionLabel = '清除篩選',
  onEmptyAction,
  maxDelay = 420,
}: RecipeGridProps) {
  if (recipes.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-4 px-6 py-16 text-center">
        <div
          aria-hidden="true"
          className="h-16 w-16 rounded-full bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.55),transparent_65%)] blur-[2px]"
        />
        <div>
          <p className="font-display text-lg font-semibold text-ink">{emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-muted">{emptyHint}</p>
        </div>
        {onEmptyAction ? (
          <button
            type="button"
            onClick={onEmptyAction}
            className="rounded-full border border-neon-purple/60 bg-neon-purple/15 px-5 py-2 text-sm font-semibold text-ink transition hover:bg-neon-purple/25"
          >
            {emptyActionLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {recipes.map((recipe, index) => (
        <RecipeCard key={recipe.id} recipe={recipe} delay={Math.min(index * 60, maxDelay)} />
      ))}
    </div>
  );
}
