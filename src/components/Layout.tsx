/**
 * 全站版面框架：導覽列、內容區、頁尾與背景裝飾層。
 *
 * 背景層以三個 radial-gradient 光暈加上網格與噪點紋理構成，
 * 以 position: fixed 固定，不隨捲動移動，避免重排。
 */
import { Outlet } from 'react-router-dom';
import { Nav } from './Nav';

/**
 * 全站版面框架。
 */
export function Layout() {
  return (
    <div className="relative min-h-screen">
      {/* 背景裝飾層：流動光暈 + 網格 + 噪點 */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-[12%] -top-[18%] h-[46rem] w-[46rem] animate-aurora-a rounded-full bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.32),transparent_62%)] blur-2xl" />
        <div className="absolute -right-[14%] top-[6%] h-[38rem] w-[38rem] animate-aurora-b rounded-full bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.24),transparent_62%)] blur-2xl" />
        <div className="absolute bottom-[-16%] left-[22%] h-[40rem] w-[40rem] animate-aurora-c rounded-full bg-[radial-gradient(circle_at_center,rgba(251,113,133,0.22),transparent_62%)] blur-2xl" />
        <div className="grid-texture absolute inset-0" />
        <div className="noise-texture absolute inset-0" />
      </div>

      <Nav />

      <main className="relative z-10">
        <Outlet />
      </main>

      <footer className="relative z-10 mt-20 border-t border-white/5 bg-night-900/60">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
          <p>
            <span className="neon-text font-display font-bold">join 這麼喝</span>
            <span className="mx-2 text-white/20">|</span>
            勾選手邊材料，即刻算出只差最少的那一杯
          </p>
          <p className="text-xs text-ink-muted/70">
            配方與食材資料整理自 IBA Official Cocktails、Difford’s Guide、Imbibe Magazine、Punchdrink，
            僅供調酒愛好者參考。
          </p>
        </div>
      </footer>
    </div>
  );
}
