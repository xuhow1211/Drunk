/**
 * 首頁主視覺區。
 *
 * 主標以字元漸顯方式入場，外層整體上浮；
 * 背景由 Layout 的流動光暈層提供，此處再疊一層專屬的柔和光斑。
 * 手機版收斂垂直空間（小標題、一句話說明、CTA 併列一行），桌機維持原氣勢。
 */
import { Link } from 'react-router-dom';
import { ArrowRightIcon } from './Icons';

/** 主標文字。 */
const TITLE = 'join 這麼喝';

/**
 * 主標的漸層字。
 *
 * 每個字元各自帶一份漸層背景，並以 background-size 與 background-position
 * 切出整句漸層的其中一段，讓「紫 → 青 → 桃」的漸層在字與字之間連續延伸。
 *
 * 之所以不用「父層一次漸層 + 子層做動畫」的做法，是因為帶動畫的子層會形成
 * 自己的圖層，父層的 background-clip: text 便無法裁切到該子層的文字，
 * 整句主標會變成看不見。
 */
function GradientTitle() {
  const chars = TITLE.split('');
  return (
    <span className="inline-flex">
      {chars.map((char, index) => (
        <span
          key={`${char}-${index}`}
          className="animate-fade-in inline-block"
          style={{
            animationDelay: `${200 + index * 70}ms`,
            backgroundImage: 'linear-gradient(96deg, #a855f7 0%, #22d3ee 48%, #fb7185 100%)',
            backgroundSize: `${chars.length * 100}% 100%`,
            backgroundPosition: `${(index / (chars.length - 1)) * 100}% 0`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

/**
 * 首頁主視覺區的兩顆 CTA：手機版併成一列小顆，桌機維持原尺寸。
 */
function HeroActions() {
  return (
    <div
      className="animate-rise mt-6 flex items-center justify-center gap-2.5 sm:mt-9 sm:gap-3"
      style={{ animationDelay: '560ms' }}
    >
      <Link
        to="/match"
        className="group inline-flex items-center gap-2 rounded-full bg-[linear-gradient(96deg,#a855f7,#22d3ee)] px-5 py-2.5 text-sm font-bold text-night-900 shadow-[0_10px_34px_-12px_rgba(168,85,247,0.95)] transition hover:shadow-[0_14px_40px_-10px_rgba(34,211,238,0.95)] sm:px-7 sm:py-3"
      >
        我手邊有什麼
        <ArrowRightIcon width={18} height={18} className="transition-transform duration-300 group-hover:translate-x-1" />
      </Link>
      <Link
        to="/classic"
        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-neon-purple/50 hover:bg-neon-purple/10 sm:px-7 sm:py-3"
      >
        先看看經典調酒
      </Link>
    </div>
  );
}

/**
 * 首頁主視覺區。
 *
 * 手機版以「入口卡才是主功能」為前提精簡：縮小標題、說明壓成一句話、
 * 兩顆 CTA 併成一列，把垂直空間讓給緊接在後的三大入口卡；
 * 桌機（sm 以上）維持原有說明與大標氣勢。
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-10 pt-12 sm:px-6 sm:pb-14 sm:pt-24 lg:px-10">
      {/* 專屬光斑 */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute left-1/2 top-4 h-[30rem] w-[30rem] -translate-x-1/2 animate-aurora-b rounded-full bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.28),transparent_65%)] blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl text-center">
        <p className="animate-fade-in inline-flex items-center gap-2 rounded-full border border-neon-cyan/35 bg-neon-cyan/10 px-4 py-1.5 text-xs text-neon-cyan" style={{ animationDelay: '80ms' }}>
          勾選手邊材料，即刻算出只差最少的那一杯
        </p>

        <h1 className="mt-4 animate-rise font-display text-4xl font-black leading-[1.08] tracking-tight sm:mt-6 sm:text-6xl lg:text-7xl">
          <GradientTitle />
        </h1>

        <p
          className="animate-rise mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted sm:mt-6 sm:text-lg"
          style={{ animationDelay: '420ms' }}
        >
          {/* 手機版說明壓成一句話，完整版只出現在桌機 */}
          <span className="sm:hidden">
            照著手邊材料點餐的調酒指南：勾選冰箱和酒櫃裡有的，就能算出只差最少的那一杯。
          </span>
          <span className="hidden sm:inline">
            這是一本「照著手邊材料點餐」的調酒指南。
            勾選你家冰箱與酒櫃裡有的東西，
            我們會用加權缺料引擎算出哪些調酒只差一兩樣就能調出來，
            連「可以用蜂蜜代替糖漿」這種替代方案都一併給你。
          </span>
        </p>

        <HeroActions />
      </div>
    </section>
  );
}
