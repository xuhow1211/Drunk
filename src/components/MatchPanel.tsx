/**
 * 比對結果面板（比對模式右欄）。
 *
 * 依使用者手邊的材料即時排序所有配方，顯示每杯缺什麼、缺得多嚴重，
 * 以及手邊材料可以替代的建議。
 */
import { useMemo, useState } from 'react';
import { compareMatchResults, getMaterialCount } from '../lib/matching';
import { parseMinutes } from '../lib/format';
import { useFlipList } from '../hooks/useFlipList';
import { useRecipeNav } from '../hooks/useRecipeNav';
import {
  AbvBadge,
  DifficultyDots,
  MissingBadge,
  MissingBaseSpiritBadge,
  SubstituteBadge,
  TagChip,
  WeightTag,
} from './Badges';
import { RECIPE_CATEGORY_LABELS } from '../lib/format';
import { AddToOwnedButton } from './AddToOwnedButton';
import type { MatchResult } from '../lib/types';

/** 結果排序方式。 */
export type MatchSort = 'closest' | 'fewest' | 'popular' | 'fastest';

/** 可選的排序方式。 */
const MATCH_SORT_OPTIONS: { value: MatchSort; label: string }[] = [
  { value: 'closest', label: '最接近' },
  { value: 'fewest', label: '缺料最少' },
  { value: 'popular', label: '最熱門' },
  { value: 'fastest', label: '最快完成' },
];

/** MatchPanel 的參數。 */
export interface MatchPanelProps {
  /** 比對結果。 */
  results: readonly MatchResult[];
  /** 使用者已選的材料數。 */
  ownedCount: number;
  /** 全部配方數。 */
  totalCount: number;
  /** 目前排序方式。 */
  sort: MatchSort;
  /** 變更排序方式。 */
  onSortChange: (sort: MatchSort) => void;
}

/** 每頁先顯示的結果數。 */
const PAGE_SIZE = 24;

/**
 * 依指定的排序方式排列比對結果。
 */
function sortResults(results: readonly MatchResult[], sort: MatchSort): MatchResult[] {
  const sorted = [...results];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'fewest':
        return a.missing.length - b.missing.length || compareMatchResults(a, b);
      case 'popular':
        return b.recipe.popularity - a.recipe.popularity || compareMatchResults(a, b);
      case 'fastest': {
        const aTime = parseMinutes(a.recipe.time);
        const bTime = parseMinutes(b.recipe.time);
        if (aTime === null && bTime === null) return compareMatchResults(a, b);
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        return aTime - bTime || compareMatchResults(a, b);
      }
      case 'closest':
      default:
        return compareMatchResults(a, b);
    }
  });
  return sorted;
}

/**
 * 比對結果面板。
 *
 * @param props 元件參數
 */
export function MatchPanel({
  results,
  ownedCount,
  totalCount,
  sort,
  onSortChange,
}: MatchPanelProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sorted = useMemo(() => sortResults(results, sort), [results, sort]);
  const visible = useMemo(() => sorted.slice(0, limit), [sorted, limit]);
  const register = useFlipList(visible.map((item) => item.recipe.id));
  const openRecipe = useRecipeNav();

  return (
    <section className="flex h-full min-w-0 flex-col" aria-label="比對結果">
      {/* 標題與排序 */}
      <div className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-ink">推薦結果</h2>
            <p className="mt-1 text-sm text-ink-muted">
              依你手邊的 <span className="font-semibold text-neon-cyan">{ownedCount}</span> 種材料，
              符合的調酒有{' '}
              <span className="font-semibold text-neon-purple">{results.length}</span> 杯
              <span className="text-ink-muted/70">（共 {totalCount} 杯配方）</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="結果排序">
            {MATCH_SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onSortChange(option.value)}
                aria-pressed={sort === option.value}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  sort === option.value
                    ? 'border-neon-purple/70 bg-neon-purple/20 text-ink'
                    : 'border-white/10 bg-white/5 text-ink-muted hover:border-white/25 hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 結果清單 */}
      <div className="mt-4 flex-1 space-y-3">
        {ownedCount === 0 ? (
          <div className="panel flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="font-display text-lg font-semibold text-ink">先選幾樣手邊的材料</p>
            <p className="max-w-md text-sm leading-relaxed text-ink-muted">
              在左側勾選你有的材料（基酒、飲料、糖漿都算），
              系統會立刻算出哪幾杯調酒只差最少材料就能調出來。
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="panel px-6 py-14 text-center text-sm text-ink-muted">
            目前材料找不到合適的調酒，試著多選幾項常備材料。
          </div>
        ) : (
          visible.map((result) => (
            <MatchCard
              key={result.recipe.id}
              result={result}
              register={register}
              onOpen={() => openRecipe(result.recipe)}
            />
          ))
        )}

        {sorted.length > visible.length ? (
          <button
            type="button"
            onClick={() => setLimit((value) => value + PAGE_SIZE)}
            className="w-full rounded-full border border-neon-purple/45 bg-neon-purple/10 px-4 py-2.5 text-sm font-semibold text-neon-purple transition hover:bg-neon-purple/20"
          >
            顯示更多（還有 {sorted.length - visible.length} 杯）
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** 單杯比對結果卡片。 */
function MatchCard({
  result,
  register,
  onOpen,
}: {
  result: MatchResult;
  register: (id: string, node: HTMLElement | null) => void;
  onOpen: () => void;
}) {
  const { recipe, missing, matchedRatio, isFullyAvailable, missingBaseSpirit } = result;
  const ratio = Math.round(matchedRatio * 100);

  return (
    <article
      ref={(node) => register(recipe.id, node)}
      data-recipe-id={recipe.id}
      className="panel p-4 transition-shadow duration-300 hover:shadow-[0_0_28px_-12px_rgba(168,85,247,0.8)]"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* 左：名稱與概要 */}
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="group block w-full cursor-pointer text-left"
            aria-label={`開啟 ${recipe.nameZh} 配方詳情`}
          >
            <h3 className="font-display text-lg font-bold leading-snug text-ink group-hover:text-neon-purple">
              {recipe.nameZh}
            </h3>
            <p className="mt-0.5 truncate text-xs uppercase tracking-wide text-ink-muted">
              {recipe.nameEn}
            </p>
          </button>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <TagChip className="border-neon-cyan/35 bg-neon-cyan/10 text-neon-cyan">
              {RECIPE_CATEGORY_LABELS[recipe.category] ?? recipe.category}
            </TagChip>
            <DifficultyDots level={recipe.difficulty} showLabel />
            <AbvBadge abv={recipe.abv} />
            <TagChip>{getMaterialCount(recipe)} 項材料</TagChip>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-ink-muted">
              <span>材料符合度</span>
              <span className="font-semibold text-ink">{ratio}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#a855f7,#22d3ee)] transition-[width] duration-500"
                style={{ width: `${ratio}%` }}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <MissingBadge count={missing.length} fullyAvailable={isFullyAvailable} />
            {missingBaseSpirit ? <MissingBaseSpiritBadge /> : null}
            <AddToOwnedButton materialIds={recipe.ingredientIds} />
          </div>
        </div>

        {/* 右：缺料清單 */}
        <div className="min-w-0 rounded-xl border border-white/8 bg-night-800/50 p-3">
          {missing.length === 0 ? (
            <p className="text-sm text-neon-green">手邊材料剛好齊全，直接開調吧。</p>
          ) : (
            <ul className="space-y-2">
              {missing.map((item) => (
                <li key={item.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <WeightTag category={item.category} />
                    <span className="font-medium text-ink">{item.zh}</span>
                    <span className="text-xs text-ink-muted">{item.en}</span>
                  </div>
                  {item.substitutes.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5 pl-1">
                      {item.substitutes.map((substitute) => (
                        <SubstituteBadge
                          key={substitute.id}
                          substitute={substitute}
                          target={item.zh}
                        />
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
