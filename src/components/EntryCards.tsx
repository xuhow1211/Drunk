/**
 * 首頁三大入口卡片。
 *
 * 「我手邊有什麼」為主要入口，尺寸與霓虹光暈都放大處理。
 */
import { Link } from 'react-router-dom';
import { ArrowRightIcon } from './Icons';

/** EntryCards 的參數。 */
export interface EntryCardsProps {
  /** 經典與新時代系列的配方數。 */
  classicCount: number;
  /** 熱門票選系列的配方數。 */
  popularCount: number;
}

/** 入口卡片內容設定。 */
const ENTRIES = [
  {
    to: '/classic',
    title: '經典調酒',
    accent: 'from-neon-purple/25 to-neon-cyan/10',
    text: 'IBA 官方經典與新時代飲品，認真做過的標準配方。',
    highlighted: false,
  },
  {
    to: '/popular',
    title: '熱門推薦',
    accent: 'from-neon-cyan/25 to-neon-purple/10',
    text: "Difford's、Punchdrink、Imbibe 等來源票選出的高人氣酒款。",
    highlighted: false,
  },
  {
    to: '/match',
    title: '我手邊有什麼',
    accent: 'from-neon-pink/25 to-neon-purple/20',
    text: '勾選現有材料，算出最能調出來的調酒，直接列出還缺哪幾樣。',
    highlighted: true,
  },
];

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
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 md:grid-cols-3">
        {ENTRIES.map((entry, index) => (
          <Link
            key={entry.to}
            to={entry.to}
            style={{ animationDelay: `${index * 120}ms` }}
            className={[
              'group panel panel-hover animate-rise relative flex flex-col overflow-hidden p-6 no-underline',
              entry.highlighted
                ? 'md:-translate-y-3 md:scale-[1.04] md:p-8'
                : '',
            ].join(' ')}
          >
            {/* 主要入口的脈動光暈 */}
            {entry.highlighted ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-4 -z-10 animate-pulse-neon rounded-[28px] bg-[radial-gradient(circle_at_50%_0%,rgba(251,113,133,0.35),transparent_65%)]"
              />
            ) : null}

            <span
              aria-hidden="true"
              className={`absolute inset-x-0 top-0 h-28 bg-gradient-to-b ${entry.accent} opacity-70 transition-opacity duration-300 group-hover:opacity-100`}
            />

            <div className="relative">
              <p className="text-xs font-semibold tracking-widest text-ink-muted">
                {entry.highlighted ? '核心玩法' : '瀏覽'}
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-ink">{entry.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{entry.text}</p>

              {counts[entry.to] ? (
                <p className="mt-3 text-xs text-neon-cyan">{counts[entry.to]} 杯配方</p>
              ) : null}

              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-neon-purple">
                開始使用
                <ArrowRightIcon
                  width={18}
                  height={18}
                  className="transition-transform duration-300 group-hover:translate-x-1.5"
                />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
