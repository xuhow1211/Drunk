/**
 * 手機版下緣固定導覽列（底部 tab bar）。
 *
 * 768px 以下出現：固定於畫面下緣的 4 個入口——首頁、經典調酒、熱門推薦、
 * 手邊有什麼。每個 tab 的高度（56px）與安全區距已預留為觸控目標，
 * 目前所在頁面由 NavLink 自動加上 aria-current="page" 並以霓虹色高亮。
 * 768px 以上不渲染，頂部導覽承接全部入口。
 *
 * 圖示沿用既有 Icons 圖示：調酒杯（品牌意象）、星星（經典款）、
 * 火焰（熱門）、放大鏡（找出手邊能調的酒）。
 */
import { NavLink } from 'react-router-dom';
import { FlameIcon, GlassIcon, SearchIcon, StarIcon } from './Icons';
import type { SVGProps } from 'react';
import type { ComponentType } from 'react';

/** 底部 tab 的項目設定。 */
interface TabItem {
  /** 路由路徑。 */
  to: string;
  /** 顯示文字。 */
  label: string;
  /** 路徑為前綴完全比對（首頁「/」須用 end 才不會一直是 active）。 */
  end: boolean;
  /** tab 專屬圖示。 */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** 底部 tab 清單。 */
const TABS: readonly TabItem[] = [
  { to: '/', label: '首頁', end: true, icon: GlassIcon },
  { to: '/classic', label: '經典調酒', end: false, icon: StarIcon },
  { to: '/popular', label: '熱門推薦', end: false, icon: FlameIcon },
  { to: '/match', label: '手邊有什麼', end: false, icon: SearchIcon },
];

/**
 * 手機版下緣固定導覽列。
 */
export function TabBar() {
  return (
    <nav
      aria-label="下方導覽"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-night-900/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="flex items-stretch">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.to} className="min-w-0 flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  [
                    'flex min-h-14 flex-col items-center justify-center gap-1 px-1 pt-2 text-[10px] font-medium transition-colors duration-200',
                    isActive ? 'text-neon-cyan' : 'text-ink-muted hover:text-ink',
                  ].join(' ')
                }
              >
                <Icon width={20} height={20} />
                <span className="truncate">{tab.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
