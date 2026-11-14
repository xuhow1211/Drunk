/**
 * 配方詳情抽屜。
 *
 * 從右側滑入、含半透明遮罩，支援 Esc 關閉、點遮罩關閉與焦點鎖定。
 * 內容包含材料表、步驟、裝飾、來源與相關推薦。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getIngredient } from '../lib/ingredients';
import { glassIllustrationUrl } from '../lib/glassIllustration';
import {
  FLAVOR_LABELS,
  GLASS_LABELS,
  ICE_LABELS,
  RECIPE_CATEGORY_LABELS,
  categoryGradient,
  difficultyLabel,
} from '../lib/format';
import { useRecipeNav } from '../hooks/useRecipeNav';
import { AbvBadge, DifficultyDots, PopularityMark, TagChip } from './Badges';
import { CloseIcon, GlassIcon, LayersIcon, StarIcon } from './Icons';
import type { Recipe } from '../lib/types';

/** RecipeDrawer 的參數。 */
export interface RecipeDrawerProps {
  /** 要顯示的配方；null 表示關閉。 */
  recipe: Recipe | null;
  /** 關閉抽屜。 */
  onClose: () => void;
  /** 相關推薦（同分類的其他配方）。 */
  related: readonly Recipe[];
}

/** 可聚焦元素的選擇器，供焦點鎖定使用。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 配方詳情抽屜。
 *
 * @param props 元件參數
 */
export function RecipeDrawer({ recipe, onClose, related }: RecipeDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<Recipe | null>(recipe);
  const [visible, setVisible] = useState(false);
  const openRecipe = useRecipeNav();

  // 開啟時淡入、關閉時淡出（淡出結束後才卸載內容）
  useEffect(() => {
    if (recipe) {
      setContent(recipe);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    return undefined;
  }, [recipe]);

  // 開啟時鎖住背景捲動
  useEffect(() => {
    if (!visible) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [visible]);

  // Esc 關閉與焦點鎖定
  useEffect(() => {
    if (!visible) return undefined;
    const panel = panelRef.current;

    const focusable = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (element) => element.offsetParent !== null,
          )
        : [];

    const timer = window.setTimeout(() => {
      const list = focusable();
      (list[0] ?? panel)?.focus();
    }, 60);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusable();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visible, onClose]);

  if (!content) return null;

  const difficultyText = difficultyLabel(content.difficulty);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${content.nameZh} 配方詳情`}>
      {/* 遮罩 */}
      <button
        type="button"
        aria-label="關閉配方詳情"
        onClick={onClose}
        className={`absolute inset-0 h-full w-full cursor-default bg-night-900/75 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* 抽屜本體 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-neon-purple/30 bg-night-900/95 shadow-[0_0_60px_-10px_rgba(168,85,247,0.45)] backdrop-blur-2xl transition-transform duration-300 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 標頭 */}
        <div
          className="relative shrink-0 overflow-hidden px-5 pb-5 pt-6 sm:px-7"
          style={{ background: categoryGradient(content.category) }}
        >
          <span
            aria-hidden="true"
            className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/20 blur-2xl"
          />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/80">
                {RECIPE_CATEGORY_LABELS[content.category]}
              </p>
              <h2 className="mt-1 font-display text-2xl font-black leading-tight text-white sm:text-3xl">
                {content.nameZh}
              </h2>
              <p className="mt-1 text-sm text-white/85">{content.nameEn}</p>
              {content.aliases.length > 0 ? (
                <p className="mt-1 text-xs text-white/70">別名：{content.aliases.join('、')}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full border border-white/30 bg-black/30 p-2 text-white transition hover:bg-black/50"
              aria-label="關閉"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* 內容 */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {/* 圖片區：示意照片優先，載入失敗或無實照時以杯型插畫替代（以 key 重設失敗狀態） */}
          <RecipePicture key={content.id} recipe={content} />

          {/* 概要資訊 */}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <InfoCell label="杯型" value={GLASS_LABELS[content.glass]} icon={<GlassIcon width={16} height={16} />} />
            <InfoCell label="冰塊" value={ICE_LABELS[content.ice] ?? content.ice} />
            <InfoCell label="酒精濃度" value={content.abv} />
            <InfoCell label="製作時間" value={content.time} />
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AbvBadge abv={content.abv} />
            <TagChip className="border-neon-gold/40 bg-neon-gold/10 text-neon-gold">
              難度 {content.difficulty}／3（{difficultyText}）
            </TagChip>
            <DifficultyDots level={content.difficulty} />
            <PopularityMark popularity={content.popularity} />
          </div>

          {content.flavor.length > 0 || content.occasion.length > 0 ? (
            <div className="mt-4 space-y-2">
              {content.flavor.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-muted">風味</span>
                  {content.flavor.map((flavor) => (
                    <TagChip key={flavor}>{FLAVOR_LABELS[flavor] ?? flavor}</TagChip>
                  ))}
                </div>
              ) : null}
              {content.occasion.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-muted">場合</span>
                  {content.occasion.map((occasion) => (
                    <TagChip key={occasion} className="border-neon-cyan/35 bg-neon-cyan/10 text-neon-cyan">
                      {occasion}
                    </TagChip>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 材料表 */}
          <Section title="材料" icon={<LayersIcon width={16} height={16} />}>
            <ul className="divide-y divide-white/5">
              {content.ingredients.map((item) => {
                const ingredient = getIngredient(item.id);
                return (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {ingredient?.zh ?? item.id}
                        {item.optional ? (
                          <span className="ml-2 rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-ink-muted">
                            選用
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-ink-muted">{ingredient?.en ?? ''}</p>
                    </div>
                    <p className="shrink-0 text-sm text-neon-cyan">
                      {item.amount === null ? '依口味調整' : `${item.amount} ${item.unit ?? ''}`.trim()}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Section>

          {/* 步驟 */}
          <Section title="步驟" icon={<StarIcon width={16} height={16} />}>
            <ol className="space-y-3">
              {content.steps.map((step, index) => (
                // 步驟文字可能重複，因此以「索引＋文字」為鍵，避免 React 的重複鍵警告
                <li key={`${index}-${step}`} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neon-purple/50 bg-neon-purple/15 text-xs font-bold text-neon-purple">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-relaxed text-ink/90">{step}</p>
                </li>
              ))}
            </ol>
          </Section>

          {/* 裝飾 */}
          {content.garnish.length > 0 ? (
            <Section title="裝飾">
              <div className="flex flex-wrap gap-1.5">
                {content.garnish.map((id) => {
                  const ingredient = getIngredient(id);
                  return (
                    <TagChip key={id} className="border-neon-gold/40 bg-neon-gold/10 text-neon-gold">
                      {ingredient?.zh ?? id}
                    </TagChip>
                  );
                })}
              </div>
            </Section>
          ) : null}

          {/* 來源 */}
          <Section title="來源">
            <div className="rounded-xl border border-white/10 bg-night-800/70 p-3 text-sm">
              <p className="text-ink-muted">
                出處：
                <span className="text-ink">{content.sourceSite ?? '整理自調酒資料集'}</span>
              </p>
              {content.sourceUrl ? (
                <a
                  href={content.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-block break-all text-neon-cyan underline decoration-dotted underline-offset-4 hover:text-ink"
                >
                  {content.sourceUrl}
                </a>
              ) : null}
            </div>
          </Section>

          {/* 相關推薦 */}
          {related.length > 0 ? (
            <Section title="相關推薦">
              <div className="grid grid-cols-2 gap-3">
                {related.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openRecipe(item)}
                    className="panel panel-hover overflow-hidden p-3 text-left"
                  >
                    <p className="font-display text-sm font-bold text-ink">{item.nameZh}</p>
                    <p className="mt-0.5 truncate text-[11px] uppercase tracking-wide text-ink-muted">
                      {item.nameEn}
                    </p>
                    <p className="mt-2 text-xs text-neon-purple">
                      {RECIPE_CATEGORY_LABELS[item.category]}
                    </p>
                  </button>
                ))}
              </div>
            </Section>
          ) : null}

          <p className="mt-6 text-center text-xs text-ink-muted/70">
            想試試看手上現有的材料能調出什麼？
            <Link to="/match" className="ml-1 text-neon-cyan underline underline-offset-4">
              前往「我手邊有什麼」
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * 抽屜內容區最上方的圖片區。
 *
 * 顯示規則：
 *   - 有示意照片（recipe.photoUrl）時以全幅 16:9 顯示實照，下緣附「照片：IBA World」來源小字；
 *   - 實照載入失敗（onerror）或無實照時改顯示通用杯型插畫（依 glass 對應，插畫下方不附來源字）。
 *
 * 元件內容不影響抽屜的捲動邏輯：圖片區是捲動內容的第一個區塊，
 * 高度固定為 aspect-video，不使用任何 sticky／fixed 定位。
 *
 * @param props 元件參數（recipe 以 key 綁定配方，切換配方時整體重建以重設失敗狀態）
 */
function RecipePicture({ recipe }: { recipe: Recipe }) {
  // 實照載入失敗的本地狀態：onerror 後退回插畫，切換配方時由 key 重建重設。
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = recipe.photoUrl !== undefined && !photoFailed;

  return (
    <figure className="m-0">
      {showPhoto ? (
        <>
          <img
            src={recipe.photoUrl}
            alt={`${recipe.nameZh} 示意照片`}
            loading="lazy"
            onError={() => setPhotoFailed(true)}
            className="aspect-video w-full rounded-xl border border-white/10 bg-night-800/50 object-cover"
          />
          <figcaption className="mt-1 text-right text-[11px] text-ink-muted">照片：IBA World</figcaption>
        </>
      ) : (
        <img
          src={glassIllustrationUrl(recipe.glass)}
          alt={`${recipe.nameZh} 示意插畫`}
          loading="lazy"
          className="aspect-video w-full rounded-xl border border-white/10"
        />
      )}
    </figure>
  );
}

/** 抽屜內的單一資訊格。 */
function InfoCell({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-night-800/70 px-3 py-2">
      <dt className="flex items-center gap-1 text-[11px] text-ink-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

/** 抽屜內的段落標題。 */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold tracking-wide text-neon-purple">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
