/**
 * 首頁入口卡片的插畫。
 *
 * 三張卡片各有一張專屬插畫，用 SVG path 直接畫出來：
 *   - 經典調酒：馬天尼杯與橄欖
 *   - 熱門推薦：岩石杯、冰塊與昇起的煙霧
 *   - 我手邊有什麼：酒瓶、雪克杯與柑橘切片
 *
 * 刻意不用照片：照片會增加數百 KB 的資產、依賴外部圖源、且授權需逐一確認；
 * SVG 插畫只有幾 KB、離線可用、不會載入失敗，還能直接吃��卡片的主題色。
 *
 * 線條一律用 currentColor，填色用 currentColor 的漸層，
 * 因此只要改外層容器的文字��色，插畫就會跟著換色。
 */
import { useId } from 'react';

/** 插畫的共用參數。 */
export interface EntryIllustrationProps {
  /** 額外的 className。 */
  className?: string;
}

/**
 * 經典調酒：一支馬天尼杯，杯緣掛著橄欖。
 *
 * @param props 元件參數
 */
export function ClassicCocktailIllustration({ className }: EntryIllustrationProps) {
  const id = useId();

  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-drink`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.6" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.12" />
        </linearGradient>
      </defs>

      {/* 杯中酒液 */}
      <path
        d="M33 45C38 62 46 72 60 79C74 72 82 62 87 45Z"
        fill={`url(#${id}-drink)`}
      />

      {/* 杯身與杯腳 */}
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 31C31 58 43 74 60 82C77 74 89 58 97 31" />
        <path d="M23 31H97" />
        <path d="M60 82V103" />
      </g>

      {/* 杯底 */}
      <ellipse cx="60" cy="104" rx="21" ry="4.5" stroke="currentColor" strokeWidth="2.4" opacity="0.75" />

      {/* 橄欖叉與橄欖 */}
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M38 35L74 57" opacity="0.85" />
      </g>
      <circle cx="77" cy="59" r="5.5" fill="currentColor" opacity="0.75" />

      {/* 杯身高光 */}
      <path
        d="M32 38C36 52 42 61 49 67"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  );
}

/**
 * 熱門推薦：裝了冰塊的岩石杯，杯口昇起煙霧。
 *
 * @param props 元件參數
 */
export function PopularCocktailIllustration({ className }: EntryIllustrationProps) {
  const id = useId();

  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-ice`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* 杯中液體 */}
      <path d="M35 66H85L79 100H41Z" fill={`url(#${id}-ice)`} />

      {/* 冰塊 */}
      <g fill="currentColor" opacity="0.32">
        <rect x="42" y="42" width="15" height="15" rx="3.5" transform="rotate(-14 49.5 49.5)" />
        <rect x="60" y="46" width="16" height="16" rx="3.5" transform="rotate(9 68 54)" />
        <rect x="47" y="58" width="13" height="13" rx="3" transform="rotate(-6 53.5 64.5)" />
      </g>

      {/* 杯身 */}
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M34 34L41 101H79L86 34" />
        <path d="M34 34H86" />
      </g>

      {/* 液面 */}
      <path d="M36 67H84" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />

      {/* 杯口檸檬片 */}
      <g stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <circle cx="90" cy="36" r="9" opacity="0.9" />
        <path d="M90 27V45M83 32L97 40M97 32L83 40" opacity="0.55" />
      </g>

      {/* 昇起的煙霧 */}
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.45">
        <path d="M47 26C43 18 51 14 47 6" />
        <path d="M61 22C56 14 66 8 61 0" opacity="0.7" />
        <path d="M75 26C71 18 79 14 75 6" />
      </g>
    </svg>
  );
}

/**
 * 我手邊有什麼：酒瓶、雪克杯與柑橘切片，代表手邊的材料。
 *
 * @param props 元件參數
 */
export function MaterialsIllustration({ className }: EntryIllustrationProps) {
  const id = useId();

  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-bottle`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {/* 酒瓶 */}
      <path d="M22 40H32V54L36 100H18L22 54Z" fill={`url(#${id}-bottle)`} />
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 40H32V54L36 100H18L22 54Z" />
        <path d="M21 32H33V40H21Z" />
      </g>
      <path d="M24 62H30V84H24Z" stroke="currentColor" strokeWidth="1.8" opacity="0.45" />

      {/* 雪克杯 */}
      <path d="M50 46L45 100H75L70 46Z" fill={`url(#${id}-bottle)`} opacity="0.7" />
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 46L45 100H75L70 46" />
        <path d="M48 46H72L69 34H51Z" />
        <path d="M56 34V28H64V34" />
      </g>

      {/* 柑橘切片 */}
      <g stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
        <circle cx="92" cy="80" r="14" />
        <path d="M92 66V94M78 80H106M82.5 70.5L101.5 89.5M101.5 70.5L82.5 89.5" opacity="0.55" />
      </g>

      {/* 散落的小材料 */}
      <g fill="currentColor" opacity="0.5">
        <circle cx="90" cy="38" r="4" />
        <circle cx="104" cy="52" r="3" opacity="0.7" />
        <circle cx="82" cy="30" r="2.5" opacity="0.6" />
      </g>
    </svg>
  );
}
