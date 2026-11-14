/**
 * 超商調酒頁。
 *
 * 與瀏覽頁共用版面與篩選邏輯，差異在：
 *   - 不限定任何配方系列（便利商店標籤跨來源都有）；
 *   - 頁面開啟時預設套用「便利商店」標籤篩選，直接呈現材料在便利商店買得到的清單。
 */
import { BrowsePage } from './Browse';
import { CONVENIENCE_STORE_TAG } from '../lib/filters';

/**
 * 超商調酒頁面。
 */
export function Easy() {
  return (
    <BrowsePage
      title="超商調酒"
      subtitle="材料在便利商店就買得到：高粱、米酒頭、養樂多、無糖烏龍茶等常備飲品，回家兌一兌就能開喝。"
      initialFilters={{ tags: [CONVENIENCE_STORE_TAG] }}
    />
  );
}
