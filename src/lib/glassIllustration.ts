/**
 * 通用杯型插畫的選擇。
 *
 * 無示意照片的配方在詳情抽屜顯示杯型插畫，共三張
 *（src/assets/glass-*.svg，視覺語彙比照首頁入口卡插畫）：
 *   - glass-coupe：淺口有腳杯家族（雞尾酒杯／馬丁尼杯／尼克諾拉／酒杯杯）
 *   - glass-rocks：矮胖直筒杯家族（古典杯／高球杯的矮款／shot 烈酒杯）
 *   - glass-highball：高瘦杯家族（高球杯／可林杯／笛形杯／馬克杯）與其他
 *
 * 對照表以 Record<GlassType, string> 收斂：GlassType 新增成員而未對應時
 * 會在編譯期失敗，不會漏到執行期才出現英文杯名或 missing key。
 */
import coupeUrl from '../assets/glass-coupe.svg';
import rocksUrl from '../assets/glass-rocks.svg';
import highballUrl from '../assets/glass-highball.svg';
import type { GlassType } from './types';

/**
 * 杯型到插畫網址的完整對照表。
 *
 * 取捨說明（非一對一的視覺近似歸類）：
 *   - martini／nick-nora 與 coupe 同屬淺口有腳杯，wine 亦為有腳杯，共用 glass-coupe
 *   - tumbler 與 rocks 同屬矮直筒杯，shot 為小杯烈酒的矮直筒形，共用 glass-rocks
 *   - flute 為高瘦杯、mug 以高直筒意象最接近，other（其他）一律以
 *     glass-highball 呈現，因此 highball 家族同時是「未知杯型」的回退插畫
 */
const GLASS_ILLUSTRATIONS: Record<GlassType, string> = {
  coupe: coupeUrl,
  martini: coupeUrl,
  'nick-nora': coupeUrl,
  wine: coupeUrl,
  rocks: rocksUrl,
  tumbler: rocksUrl,
  shot: rocksUrl,
  highball: highballUrl,
  collins: highballUrl,
  flute: highballUrl,
  mug: highballUrl,
  other: highballUrl,
};

/**
 * 取得杯型對應的通用插畫網址。
 *
 * @param glass 建議杯型
 * @returns 插畫資產網址；值不在對照表內（來源端出現未知杯型）時回退 glass-highball
 */
export function glassIllustrationUrl(glass: GlassType): string {
  return GLASS_ILLUSTRATIONS[glass] ?? highballUrl;
}
