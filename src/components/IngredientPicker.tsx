/**
 * 材料選擇器（比對模式左欄）。
 *
 * 依分類分頁呈現食材晶片，支援中文、英文與別名搜尋，
 * 並提供常備材料快捷區與一鍵清空、隨機挑選等輔助操作。
 *
 * 手邊材料的狀態來自 useOwnedIngredients（全站共用同一份），
 * 因此左欄的勾選與右欄結果清單、按鈕的「已加入」狀態永遠一致。
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getByCategory,
  getCategories,
  getCommonIngredients,
  searchIngredients,
} from '../lib/ingredients';
import { useOwnedIngredients } from '../hooks/useOwnedIngredients';
import { CheckIcon, SearchIcon } from './Icons';
import type { Ingredient, IngredientCategory } from '../lib/types';

/** 隨機挑選時使用的材料數量。 */
const RANDOM_PICK_COUNT = 5;

/** 分頁選項：全部或單一分類。 */
type CategoryTab = 'all' | IngredientCategory;

/**
 * 材料選擇器。
 */
export function IngredientPicker() {
  const { owned, toggle, replace, clear } = useOwnedIngredients();
  const [tab, setTab] = useState<CategoryTab>('all');
  const [query, setQuery] = useState('');
  const [commonExpanded, setCommonExpanded] = useState(false);

  const categories = useMemo(() => getCategories(), []);
  const common = useMemo(() => getCommonIngredients(), []);

  // 搜尋優先；無搜尋字時依分類分頁顯示
  const keyword = query.trim();
  const visible = useMemo(() => {
    if (keyword) return searchIngredients(keyword);
    if (tab === 'all') return [];
    return getByCategory(tab);
  }, [keyword, tab]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const category of categories) {
      map.set(category.id, getByCategory(category.id).length);
    }
    return map;
  }, [categories]);

  /** 隨機挑選 5 種常備材料（取代目前選擇）。 */
  const randomPick = () => {
    const pool = getCommonIngredients();
    const picked = new Set<string>();
    while (picked.size < RANDOM_PICK_COUNT && pool.length > 0) {
      const index = Math.floor(Math.random() * pool.length);
      const item = pool[index];
      if (item) picked.add(item.id);
    }
    replace([...picked]);
  };

  return (
    <section className="panel flex h-full flex-col p-4 sm:p-5" aria-label="材料選擇器">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">手邊的材料</h2>
          <p className="mt-0.5 text-xs text-ink-muted">勾選你有的，缺什麼會即時算出來</p>
        </div>
        <span className="shrink-0 rounded-full border border-neon-purple/50 bg-neon-purple/15 px-3 py-1 text-xs font-semibold text-neon-purple">
          已選 {owned.size} 種
        </span>
      </header>

      {/* 搜尋 */}
      <div className="relative mt-4">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
          <SearchIcon width={18} height={18} />
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋材料（中英文、別名）"
          aria-label="搜尋材料"
          className="w-full rounded-full border border-white/10 bg-night-800/80 py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink-muted/60 focus:border-neon-purple/60 focus:outline-none"
        />
      </div>

      {/* 分類分頁 */}
      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto pb-1">
        <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
          全部
        </TabButton>
        {categories.map((category) => (
          <TabButton
            key={category.id}
            active={tab === category.id}
            onClick={() => setTab(category.id as IngredientCategory)}
          >
            {category.zh}
            <span className="ml-1 text-[10px] opacity-70">{counts.get(category.id) ?? 0}</span>
          </TabButton>
        ))}
      </div>

      {/* 常備材料快捷區 */}
      {!keyword && tab === 'all' ? (
        <div className="mt-4 rounded-xl border border-neon-gold/25 bg-neon-gold/5 p-3">
          <button
            type="button"
            onClick={() => setCommonExpanded((value) => !value)}
            aria-expanded={commonExpanded}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-xs font-semibold tracking-wide text-neon-gold">
              常備材料（台灣便利商店等處可得）
            </span>
            <span className="text-[11px] text-ink-muted">
              {commonExpanded ? '收合' : `展開 ${common.length} 種`}
            </span>
          </button>
          {commonExpanded ? (
            <div className="mt-2.5 max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {common.map((ingredient) => (
                <IngredientChip
                  key={ingredient.id}
                  ingredient={ingredient}
                  selected={owned.has(ingredient.id)}
                  onToggle={toggle}
                />
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
              蘇打水、雪碧、可樂、蜂蜜、柳橙汁、檸檬汁、蔓越莓汁、椰奶、鹽等常見品項都在這裡。
            </p>
          )}
        </div>
      ) : null}

      {/* 材料清單 */}
      <div className="mt-4 min-h-0 max-h-[55vh] flex-1 overflow-y-auto pr-1 lg:max-h-none">
        {keyword ? (
          <>
            <p className="mb-2 text-xs text-ink-muted">
              搜尋「{keyword}」找到 {visible.length} 項
            </p>
            {visible.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {visible.map((ingredient) => (
                  <IngredientChip
                    key={ingredient.id}
                    ingredient={ingredient}
                    selected={owned.has(ingredient.id)}
                    onToggle={toggle}
                  />
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-ink-muted">找不到符合的材料</p>
            )}
          </>
        ) : tab === 'all' ? (
          <p className="py-6 text-center text-xs leading-relaxed text-ink-muted">
            請先選擇上方任一分類，或直接搜尋材料名稱。
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visible.map((ingredient) => (
              <IngredientChip
                key={ingredient.id}
                ingredient={ingredient}
                selected={owned.has(ingredient.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
      </div>

      {/* 輔助操作 */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/5 pt-3">
        <button
          type="button"
          onClick={randomPick}
          className="flex-1 rounded-full border border-neon-cyan/45 bg-neon-cyan/10 px-3 py-2 text-xs font-semibold text-neon-cyan transition hover:bg-neon-cyan/20"
        >
          隨機挑 5 種
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={owned.size === 0}
          className="flex-1 rounded-full border border-neon-pink/45 bg-neon-pink/10 px-3 py-2 text-xs font-semibold text-neon-pink transition hover:bg-neon-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          一鍵清空
        </button>
      </div>
    </section>
  );
}

/** 分頁按鈕。 */
function TabButton({
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
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? 'border-neon-purple/70 bg-neon-purple/20 text-ink'
          : 'border-white/10 bg-white/5 text-ink-muted hover:border-white/25 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** 單一材料晶片。 */
function IngredientChip({
  ingredient,
  selected,
  onToggle,
}: {
  ingredient: Ingredient;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const hint = [ingredient.en, ...ingredient.aliases].filter(Boolean).join('／');
  return (
    <button
      type="button"
      onClick={() => onToggle(ingredient.id)}
      aria-pressed={selected}
      title={hint}
      className={[
        'group inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
        selected
          ? 'animate-chip-pop border-neon-purple/80 bg-neon-purple/20 text-ink shadow-[0_0_16px_-3px_rgba(168,85,247,0.95)]'
          : 'border-white/10 bg-white/5 text-ink-muted hover:border-neon-purple/45 hover:text-ink',
      ].join(' ')}
    >
      {selected ? <CheckIcon width={13} height={13} className="text-neon-cyan" /> : null}
      {ingredient.zh}
    </button>
  );
}
