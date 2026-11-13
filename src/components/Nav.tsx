/**
 * 頂部導覽列。
 *
 * 固定在頁面上方，點選路由時以霓虹漸層底線標示目前所在頁面。
 * 右側為會員區：已登入顯示名稱與登出按鈕，未登入顯示登入入口。
 */
import { Link, NavLink } from 'react-router-dom';
import { signOut, useAuth } from '../lib/authStore';

/** 導覽項目設定。 */
const LINKS = [
  { to: '/', label: '首頁', end: true },
  { to: '/classic', label: '經典調酒', end: false },
  { to: '/popular', label: '熱門推薦', end: false },
  { to: '/match', label: '我手邊有什麼', end: false },
];

/**
 * 導覽列右側的會員區。
 */
function AuthArea() {
  const { status, displayName, available } = useAuth();

  if (!available) return null;
  if (status === 'initializing') {
    return <span className="hidden shrink-0 text-xs text-ink-muted lg:inline">會員狀態讀取中…</span>;
  }
  if (status === 'signedIn') {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="max-w-[8rem] truncate text-sm font-medium text-ink" title={displayName ?? ''}>
          {displayName ?? '會員'}
        </span>
        <button
          type="button"
          onClick={() => {
            signOut().catch(() => {
              // 登出失敗時交由下一次操作重試，不在導覽列插錯誤訊息
            });
          }}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-white/5 hover:text-ink"
        >
          登出
        </button>
      </div>
    );
  }
  return (
    <Link
      to="/auth"
      className="shrink-0 rounded-full border border-neon-purple/60 bg-neon-purple/15 px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-neon-purple/25 no-underline"
    >
      登入
    </Link>
  );
}

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

        <AuthArea />
      </nav>
    </header>
  );
}
