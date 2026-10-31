/**
 * 內嵌 SVG 圖示。
 *
 * 專案不引入外部圖示套件，也不使用 emoji，
 * 因此以最簡單的 stroke 風格 SVG 實作需要的少數圖示。
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** 共用的 svg 屬性（線條風格、跟隨文字色）。 */
const base: IconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

/** 右箭頭，用於卡片按鈕。 */
export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** 火焰，用於熱門標記。 */
export function FlameIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3c2 3.2 4.5 4.6 4.5 8a4.5 4.5 0 0 1-9 0c0-1.6.7-2.7 1.6-3.8.3 1 .9 1.6 1.7 1.9C10.4 7.5 10.7 5 12 3Z" />
    </svg>
  );
}

/** 放大鏡，用於搜尋框。 */
export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

/** 關閉叉號，用於抽屜關閉鈕。 */
export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/** 打勾，用於已選材料的晶片。 */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 13 4.5 4.5L19 7" />
    </svg>
  );
}

/** 星星，用於難度與熱門度。 */
export function StarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
    </svg>
  );
}

/** 攪拌匙（調酒杯），用於裝飾或步驟圖示。 */
export function GlassIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3h12l-5 6v11M8 20h8" />
    </svg>
  );
}

/** 沙漏，用於製作時間。 */
export function ClockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** 層（材料），用於材料數。 */
export function LayersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m12 3 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
    </svg>
  );
}

/** 拼圖（缺料），用於缺料徽章。 */
export function PuzzleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4.5a1.6 1.6 0 0 1 3.2 0c0 .6-.3 1-.7 1.4h3.9c.5 0 .9.4.9.9v3.6c.4-.4.8-.6 1.3-.6a1.6 1.6 0 0 1 0 3.2c-.5 0-.9-.2-1.3-.6v4c0 .5-.4.9-.9.9h-4.1c.4-.4.6-.8.6-1.3a1.6 1.6 0 0 0-3.2 0c0 .5.2.9.6 1.3H6.3c-.5 0-.9-.4-.9-.9v-4c-.4.4-.8.6-1.3.6a1.6 1.6 0 0 1 0-3.2c.5 0 .9.2 1.3.6v-3.6c0-.5.4-.9.9-.9h3.2c-.4-.4-.7-.8-.7-1.4Z" />
    </svg>
  );
}

/** 眼睛（查看配方），用於卡片上的檢視提示。 */
export function EyeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
