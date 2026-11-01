/**
 * 瀏覽模式的篩選列。
 *
 * 提供分類、風味、場合、難度、酒精濃度區間與搜尋，
 * 以及排序切換與一鍵重設。
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { FLAVOR_LABELS, RECIPE_CATEGORY_LABELS, difficultyLabel } from '../lib/format';
import { SORT_OPTIONS } from '../lib/filters';
import type { FilterFacets, FilterState, SortKey } from '../lib/filters';
import { SearchIcon } from './Icons';

/** FilterBar 的參數。 */
export interface FilterBarProps {
  /** 目前篩選狀態。 */
  filters: FilterState;
  /** 狀態變更時的callback。 */
  onChange: (next: FilterState) => void;
  /** 可用的篩選面向。 */
  facets: FilterFacets;
  /** 目前符合條件的配方數。 */
  resultCount: number;
}

/**
 * 在陣列中切換某個值（多選篩選的共用邏輯）。
 */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * 篩選列。
 *
 * @param props 元件參數
 */
export function FilterBar({ filters, onChange, facets, resultCount }: FilterBarProps) {
  const [groupsOpen, setGroupsOpen] = useState(false);

  const hasFilter =
    filters.categories.length > 0 ||
    filters.flavors.length > 0 ||
    filters.occasions.length > 0 ||
    filters.difficulties.length > 0 ||
    filters.abvMin !== null ||
    filters.abvMax !== null ||
    filters.query.trim() !== '';

  return (
    <section className="panel p-4 sm:p-5" aria-label="篩選與排序">
      {/* 搜尋與排序 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
            <SearchIcon width={18} height={18} />
          </span>
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            placeholder="搜尋中英文名、別名或原料（例如：琴酒、Mojito、蜂蜜）"
            aria-label="搜尋調酒"
            className="w-full rounded-full border border-white/10 bg-night-800/80 py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink-muted/60 focus:border-neon-purple/60 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="sort-select" className="whitespace-nowrap text-xs text-ink-muted">
            排序
          </label>
          <select
            id="sort-select"
            value={filters.sort}
            onChange={(event) => onChange({ ...filters, sort: event.target.value as SortKey })}
            className="rounded-full border border-white/10 bg-night-800/80 px-3 py-2 text-sm text-ink focus:border-neon-purple/60 focus:outline-none"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="whitespace-nowrap rounded-full border border-neon-cyan/35 bg-neon-cyan/10 px-3 py-1.5 text-xs text-neon-cyan">
            {resultCount} 杯
          </span>
        </div>
      </div>

      {/* 篩選面向：行動版預設收合，避免篩選列佔滿整個畫面 */}
      <div className="mt-3 lg:hidden">
        <button
          type="button"
          onClick={() => setGroupsOpen((value) => !value)}
          aria-expanded={groupsOpen}
          className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-ink-muted transition hover:text-ink"
        >
          {groupsOpen ? '收合篩選條件' : '展開篩選條件（分類、風味、場合、難度、酒精度）'}
        </button>
      </div>

      <div className={`mt-4 space-y-3 ${groupsOpen ? 'block' : 'hidden'} lg:block`}>
        <FilterGroup label="分類">
          {facets.categories.map((category) => (
            <ChipButton
              key={category}
              active={filters.categories.includes(category)}
              onClick={() => onChange({ ...filters, categories: toggle(filters.categories, category) })}
            >
              {RECIPE_CATEGORY_LABELS[category]}
            </ChipButton>
          ))}
        </FilterGroup>

        <FilterGroup label="風味">
          {facets.flavors.map((flavor) => (
            <ChipButton
              key={flavor}
              active={filters.flavors.includes(flavor)}
              onClick={() => onChange({ ...filters, flavors: toggle(filters.flavors, flavor) })}
            >
              {FLAVOR_LABELS[flavor] ?? flavor}
            </ChipButton>
          ))}
        </FilterGroup>

        <FilterGroup label="場合">
          {facets.occasions.map((occasion) => (
            <ChipButton
              key={occasion}
              active={filters.occasions.includes(occasion)}
              onClick={() => onChange({ ...filters, occasions: toggle(filters.occasions, occasion) })}
            >
              {occasion}
            </ChipButton>
          ))}
        </FilterGroup>

        <FilterGroup label="難度">
          {[1, 2, 3].map((level) => (
            <ChipButton
              key={level}
              active={filters.difficulties.includes(level)}
              onClick={() =>
                onChange({
                  ...filters,
                  difficulties: filters.difficulties.includes(level)
                    ? filters.difficulties.filter((item) => item !== level)
                    : [...filters.difficulties, level],
                })
              }
            >
              {difficultyLabel(level)}
            </ChipButton>
          ))}
        </FilterGroup>

        <FilterGroup label="酒精度">
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={filters.abvMin ?? ''}
              onChange={(event) =>
                onChange({
                  ...filters,
                  abvMin: event.target.value === '' ? null : Number(event.target.value),
                })
              }
              placeholder="下限"
              aria-label="酒精度下限（百分比）"
              className="w-20 rounded-full border border-white/10 bg-night-800/80 px-3 py-1.5 text-sm text-ink focus:border-neon-purple/60 focus:outline-none"
            />
            <span>～</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={filters.abvMax ?? ''}
              onChange={(event) =>
                onChange({
                  ...filters,
                  abvMax: event.target.value === '' ? null : Number(event.target.value),
                })
              }
              placeholder="上限"
              aria-label="酒精度上限（百分比）"
              className="w-20 rounded-full border border-white/10 bg-night-800/80 px-3 py-1.5 text-sm text-ink focus:border-neon-purple/60 focus:outline-none"
            />
            <span className="hidden sm:inline">%（無法解析的配方不列入區間篩選，但仍會顯示）</span>
          </div>
        </FilterGroup>
      </div>

      {hasFilter ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() =>
              onChange({
                ...filters,
                categories: [],
                flavors: [],
                occasions: [],
                difficulties: [],
                abvMin: null,
                abvMax: null,
                query: '',
              })
            }
            className="rounded-full border border-neon-pink/50 bg-neon-pink/10 px-4 py-1.5 text-xs font-semibold text-neon-pink transition hover:bg-neon-pink/20"
          >
            重設篩選
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** 一組篩選晶片。 */
function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-xs font-semibold tracking-wide text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** 可切換的篩選晶片。 */
function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-neon-purple/70 bg-neon-purple/20 text-ink shadow-[0_0_14px_-4px_rgba(168,85,247,0.9)]'
          : 'border-white/10 bg-white/5 text-ink-muted hover:border-white/25 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
