/**
 * 經典調酒頁。
 *
 * 收錄 IBA 官方經典與新時代系列飲品。
 */
import { BrowsePage } from './Browse';

/**
 * 經典調酒頁。
 */
export function Classic() {
  return (
    <BrowsePage
      title="經典調酒"
      subtitle="IBA 官方經典酒單與新時代飲品，配方經過標準化，適合當作調酒的入門基準。"
      collections={['classic', 'new-era']}
    />
  );
}
