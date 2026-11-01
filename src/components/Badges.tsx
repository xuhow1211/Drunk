/**
 * 介面共用的小型徽章與標籤元件。
 *
 * 集中管理顏色與語意，避免各頁面各自發明樣式造成不一致。
 */
import type { ReactNode } from 'react';
import { FlameIcon, PuzzleIcon, StarIcon } from './Icons';
import { SEVERITY_CLASSES, SEVERITY_LABELS, severityOf } from '../lib/severity';
import { difficultyLabel } from '../lib/format';
import type { IngredientCategory, SubstituteOption } from '../lib/types';

/** 一般標籤晶片。 */
export function TagChip({
  children,
  className = '',
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-ink-muted ${className}`}
    >
      {children}
    </span>
  );
}

/** 難度指示（1 至 3 顆圓點）。 */
export function DifficultyDots({ level, showLabel = false }: { level: number; showLabel?: boolean }) {
  // 難度文字一律取自 format.ts 的單一來源，避免各元件各寫一份
  const label = difficultyLabel(level);
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-ink-muted"
      aria-label={`難度 ${level}／3（${label}）`}
      title={`難度 ${level}／3（${label}）`}
    >
      {[1, 2, 3].map((index) => (
        <span
          key={index}
          className={`h-1.5 w-1.5 rounded-full ${
            index <= level ? 'bg-neon-gold' : 'bg-white/20'
          }`}
          aria-hidden="true"
        />
      ))}
      {showLabel ? <span className="ml-1">{label}</span> : null}
    </span>
  );
}

/** 酒精濃度徽章。 */
export function AbvBadge({ abv }: { abv: string }) {
  return (
    <TagChip className="border-neon-purple/40 bg-neon-purple/10 text-neon-purple">
      酒精濃度 {abv}
    </TagChip>
  );
}

/** 熱門度標記，熱門度 4 以上標示為熱門。 */
export function PopularityMark({ popularity }: { popularity: number }) {
  if (popularity < 4) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neon-pink/50 bg-neon-pink/15 px-2 py-0.5 text-xs font-semibold text-neon-pink">
      <FlameIcon width={13} height={13} />
      熱門
    </span>
  );
}

/** 材料數徽章。 */
export function MaterialCountBadge({ count }: { count: number }) {
  return (
    <TagChip className="border-neon-cyan/35 bg-neon-cyan/10 text-neon-cyan">
      {count} 項材料
    </TagChip>
  );
}

/** 缺料徽章：零缺料時顯示霓虹綠的「材料齊全，可直接調」。 */
export function MissingBadge({ count, fullyAvailable }: { count: number; fullyAvailable: boolean }) {
  if (fullyAvailable) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-neon-green/60 bg-neon-green/15 px-2.5 py-0.5 text-xs font-semibold text-neon-green">
        材料齊全，可直接調
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neon-pink/50 bg-neon-pink/12 px-2.5 py-0.5 text-xs font-semibold text-neon-pink">
      <PuzzleIcon width={13} height={13} />
      缺 {count} 樣
    </span>
  );
}

/** 替代建議徽章，例如「可用 蜂蜜 代替 糖漿」。 */
export function SubstituteBadge({
  substitute,
  target,
}: {
  substitute: SubstituteOption;
  target: string;
}) {
  const qualityLabel =
    substitute.quality === 'same' ? '完全同調' : substitute.quality === 'close' ? '風味接近' : '可勉強替代';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-neon-gold/45 bg-neon-gold/10 px-2.5 py-0.5 text-xs text-neon-gold"
      title={`替代品質：${qualityLabel}`}
    >
      可用 {substitute.zh} 代替 {target}
    </span>
  );
}

/** 缺料項目的權重級別標籤。 */
export function WeightTag({ category }: { category: IngredientCategory }) {
  const severity = severityOf(category);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_CLASSES[severity]}`}
      title={`${SEVERITY_LABELS[severity]}：缺少此項會影響整杯調酒`}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

/** 缺主酒警示。 */
export function MissingBaseSpiritBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neon-gold/60 bg-neon-gold/15 px-2.5 py-0.5 text-xs font-semibold text-neon-gold">
      <StarIcon width={13} height={13} />
      缺的是主酒，這杯要另外買
    </span>
  );
}
