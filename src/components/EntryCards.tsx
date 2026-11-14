/**
 * 首頁三大入口卡片。
 *
 * 整卡可點擊、杯數以徽章呈現；手機版 3 張卡片單欄、插畫縮小、
 * 說明只留一句話特色。「我手邊有什麼」為主要入口，桌機上以放大與光暈強調。
 */
import { Link } from 'react-router-dom';
import { ArrowRightIcon } from './Icons';
import {
  ClassicCocktailIllustration,
  MaterialsIllustration,
  PopularCocktailIllustration,
} from './EntryIllustrations';
import type { ReactNode } from 'react';

/** EntryCards 的參數。 */
export interface EntryCardsProps {
  /** 經典與新時代系列的配方數。 */
  classicCount: number;
  /** 熱門票選系列的配方數。 */
  popularCount: number;
}

/** 入口卡片內容設定。 */
const ENTRIES: {
  to: string;
  title: string;
  accent: string;
  /** 插畫線條與填色使用的主題色。 */
  ink: string;
  /** 插畫區往卡片邊界延伸的負邊距，要跟卡片內距一致才會齊邊。 */
  bleed: string;
  illustration: ReactNode;
  /** 一句話特色說明。 */
  text: string;
  highlighted: boolean;
}[] = [
  {
    to: '/classic',
    title: '經典調酒',
    accent: 'from-neon-purple/25 to-neon-cyan/10',
    ink: 'text-neon-purple',
    bleed: '-mx-4 -mt-4 md:-mx-6 md:-mt-6',
    illustration: <ClassicCocktailIllustration className="h-full w-full" />,
    text: 'IBA 官方經典與新時代，認真校準的標準配方。',
    highlighted: false,
  },
  {
    to: '/popular',
    title: '熱門推薦',
    accent: 'from-neon-cyan/25 to-neon-purple/10',
    ink: 'text-neon-cyan',
    bleed: '-mx-4 -mt-4 md:-mx-6 md:-mt-6',
    illustration: <PopularCocktailIllustration className="h-full w-full" />,
    text: "Difford's 等大站票選的高人氣酒款，跟著喝不踩雷。",
    highlighted: false,
  },
  {
    to: '/match',
    title: '我手邊有什麼',
    accent: 'from-neon-pink/25 to-neon-purple/20',
    ink: 'text-neon-pink',
    bleed: '-mx-4 -mt-4 md:-mx-8 md:-mt-8',
    illustration: <MaterialsIllustration className="h-full w-full" />,
    text: '勾選手邊材料，算出只差最少的那一杯。',
    highlighted: true,
  },
];

/** EntryCard 的參數。 */
interface EntryCardProps {
  /** 卡片內容設定。 */
  entry: (typeof ENTRIES)[number];
  /** 顯示在徽章上的杯數，0 表示不顯示。 */
  count: number;
  /** 進場動畫延遲（毫秒）。 */
  delay: number;
}

/**
 * 首頁單張入口卡：整卡為一個 可點擊連結，杯數以徽章呈現。
 */
function EntryCard({ entry, count, delay }: EntryCardProps) {
  return (
    <Link
      to={entry.to}
      style={{ animationDelay: `${delay}ms` }}
      className={[
        'group panel panel-hover animate-rise relative flex flex-col overflow-hidden p-4 no-underline sm:p-6',
        entry.highlighted ? 'md:-translate-y-3 md:scale-[1.04] md:p-8' : '',
      ].join(' ')}
    >
      {/* 主要入口的脈動光暈 */}
      {entry.highlighted ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-4 -z-10 animate-pulse-neon rounded-[28px] bg-[radial-gradient(circle_at_50%_0%,rgba(251,113,133,0.35),transparent_65%)]"
        />
      ) : null}

      {/* 插畫區：漸層底色加專屬 SVG 插畫（手機版縮小以壓低卡片高度） */}
      <div className={`relative h-24 overflow-hidden ${entry.bleed} sm:h-36`}>
        <span
          aria-hidden="true"
          className={`absolute inset-0 bg-gradient-to-b ${entry.accent} opacity-70 transition-opacity duration-300 group-hover:opacity-100`}
        />
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-night-900/80 to-transparent"
        />
        <div
          className={`absolute inset-0 flex items-end justify-center pb-2 ${entry.ink} opacity-85 transition-transform duration-500 group-hover:scale-105`}
        >
          {entry.illustration}
        </div>
      </div>

      <div className="relative">
        {/* 眉題只在桌機出現，手機版以主入口光暈與徽章代替資訊層級 */}
        <p className="hidden text-xs font-semibold tracking-widest text-ink-muted sm:block">
          {entry.highlighted ? '核心玩法' : '瀏覽'}
        </p>
        <h2 className="mt-2 font-display text-xl font-bold text-ink sm:text-2xl">{entry.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{entry.text}</p>

        {count ? (
          <span className="mt-3 inline-flex w-fit items-center rounded-full border border-neon-cyan/40 bg-neon-cyan/10 px-2.5 py-1 text-xs font-semibold text-neon-cyan">
            {count} 杯
          </span>
        ) : null}

        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-neon-purple sm:mt-5">
          開始使用
          <ArrowRightIcon
            width={18}
            height={18}
            className="transition-transform duration-300 group-hover:translate-x-1.5"
          />
        </span>
      </div>
    </Link>
  );
}

/**
 * 首頁三大入口卡片。
 *
 * @param props 元件參數
 */
export function EntryCards({ classicCount, popularCount }: EntryCardsProps) {
  const counts: Record<string, number> = {
    '/classic': classicCount,
    '/popular': popularCount,
    '/match': 0,
  };

  return (
    <section className="px-4 sm:px-6 lg:px-10" aria-label="主要入口">
      {/* 手機版單欄並收緊留白，桌機維持三欄 */}
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
        {ENTRIES.map((entry, index) => (
          <EntryCard
            key={entry.to}
            entry={entry}
            count={counts[entry.to] ?? 0}
            delay={index * 120}
          />
        ))}
      </div>
    </section>
  );
}
