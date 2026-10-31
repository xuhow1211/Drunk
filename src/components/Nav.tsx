/**
 * 頂部導覽列。
 *
 * 固定在頁面上方，點選路由時以霓虹漸層底線標示目前所在頁面。
 */
import { NavLink } from 'react-router-dom';

/** 導覽項目設定。 */
const LINKS = [
  { to: '/', label: '首頁', end: true },
  { to: '/classic', label: '經典調酒', end: false },
  { to: '/popular', label: '熱門推薦', end: false },
  { to: '/match', label: '我手邊有什麼', end: false },
];

/**
 * 頂部導覽列。
 */
export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-night-900/75 backdrop-blur-xl">
      <nav
        aria-label="主導覽"
        className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-10"
      >
        <NavLink
          to="/"
          className="neon-text shrink-0 font-display text-lg font-black tracking-tight sm:text-xl"
        >
          join 這麼喝
        </NavLink>

        <ul className="no-scrollbar ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
          {LINKS.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  [
                    'relative whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-200 sm:px-4',
                    isActive
                      ? 'bg-neon-purple/18 text-ink shadow-[inset_0_0_0_1px_rgba(168,85,247,0.55)]'
                      : 'text-ink-muted hover:bg-white/5 hover:text-ink',
                  ].join(' ')
                }
              >
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
