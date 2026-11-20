/**
 * 遊戲頁共用的登入守門。
 *
 * 遊戲房間需要會員身分（RPC 以 auth.uid() 驗身）與 Supabase Realtime，
 * 因此三種狀態不放行：會員功能未啟用、尚未登入、登入狀態讀取中。
 * 登入沿用既有的 /auth 頁；登入後回到首頁，再由首頁「吹牛骰子」入口返回。
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/authStore';

/** 遊戲頁共用的圓角連結按鈕樣式（霓虹紫描邊，延用全站夜色語彙）。 */
export const GAMES_LINK_BTN =
  'inline-block rounded-full border border-neon-purple/60 bg-neon-purple/25 px-5 py-2 ' +
  'text-sm font-semibold text-ink transition hover:bg-neon-purple/40 no-underline';

/** 共用面板樣式（延用全站霓虹夜色語彙的 panel）。 */
const PANEL_CLASS = 'panel w-full max-w-md p-6 text-center sm:p-8';

/**
 * 遊戲頁登入守門：就緒前不放行遊戲內容。
 *
 * @param props children 為通過守門後的頁面內容
 */
export function GamesAuthGate({ children }: { children: ReactNode }) {
  const { status, available } = useAuth();

  if (status === 'initializing') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 text-center">
        <p className="text-sm text-ink-muted">會員狀態讀取中，請稍候……</p>
      </div>
    );
  }
  if (!available) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 sm:px-6">
        <div className={PANEL_CLASS}>
          <h1 className="neon-text font-display text-2xl font-black">遊戲功能尚未啟用</h1>
          <p className="mt-3 text-sm text-ink-muted">
            線上遊戲需要會員服務（登入與即時連線），這個部署未配置，
            配方的瀏覽與手邊材料仍可正常使用。
          </p>
          <Link to="/" className={`${GAMES_LINK_BTN} mt-6`}>
            回到首頁
          </Link>
        </div>
      </div>
    );
  }
  if (status !== 'signedIn') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 sm:px-6">
        <div className={PANEL_CLASS}>
          <h1 className="neon-text font-display text-2xl font-black">請先登入</h1>
          <p className="mt-3 text-sm text-ink-muted">
            吹牛骰子為線上多人遊戲，需要登入才能建立與加入房間。
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            登入後會回到首頁，再點「吹牛骰子」即可返回本頁。
          </p>
          <Link to="/auth" className={`${GAMES_LINK_BTN} mt-6`}>
            前往登入
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
