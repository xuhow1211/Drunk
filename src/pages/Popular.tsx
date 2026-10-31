/**
 * 熱門推薦頁。
 *
 * 收錄 Difford's、Punchdrink、Imbibe 等來源的票選熱門配方。
 */
import { BrowsePage } from './Browse';

/**
 * 熱門推薦頁。
 */
export function Popular() {
  return (
    <BrowsePage
      title="熱門推薦"
      subtitle="來自 Difford’s Guide、Punchdrink 與 Imbibe Magazine 等專業媒體票選出的熱門配方。"
      collections={['popular']}
    />
  );
}
