/**
 * 缺料嚴重程度的分級規則。
 *
 * 缺基酒代表整杯要重買，嚴重程度最高；裝飾缺了照樣能喝，最低。
 */
import type { IngredientCategory } from './types';

/** 缺料嚴重程度的分級。 */
export type Severity = 'critical' | 'major' | 'minor' | 'trivial';

/**
 * 依食材分類判定缺料嚴重程度。
 *
 * @param category 食材分類
 */
export function severityOf(category: IngredientCategory): Severity {
  switch (category) {
    case 'base-spirit':
    case 'fortified-wine':
    case 'wine':
      return 'critical';
    case 'liqueur':
      return 'major';
    case 'syrup':
    case 'bitter':
    case 'dairy':
    case 'tea-coffee':
      return 'minor';
    case 'mixer':
    case 'garnish':
    default:
      return 'trivial';
  }
}

/** 各嚴重程度對應的中文說明。 */
export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '主酒級',
  major: '風味級',
  minor: '輔料級',
  trivial: '輕微級',
};

/** 各嚴重程度對應的邊框與文字色。 */
export const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: 'border-neon-pink/60 bg-neon-pink/15 text-neon-pink',
  major: 'border-neon-gold/60 bg-neon-gold/15 text-neon-gold',
  minor: 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan',
  trivial: 'border-ink-muted/40 bg-night-700/60 text-ink-muted',
};
