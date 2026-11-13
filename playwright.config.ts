/**
 * Playwright 情境測試設定。
 *
 * 測試對象是建置後的正式產物（npm run build → vite preview），
 * 因此測到的行為與實際部署結果一致。
 *
 * 瀏覽器優先使用本機已安裝的 Google Chrome（channel: 'chrome'），
 * 找不到時自動改用 Playwright 內建的 chromium。
 */
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/** 各作業系統常見的 Chrome 安裝位置。 */
const CHROME_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
};

/**
 * 判斷本機是否安裝了 Chrome；安裝了才使用 channel: 'chrome'，
 * 否則留空讓 Playwright 使用內建的 chromium。
 */
function resolveChromeChannel(): 'chrome' | undefined {
  const candidates = CHROME_PATHS[process.platform] ?? [];
  return candidates.some((path) => path.length > 0 && existsSync(path)) ? 'chrome' : undefined;
}

/** 測試伺服器的連接埠（可用 E2E_PORT 覆寫）。 */
const PORT = Number(process.env.E2E_PORT ?? 4173);

/** 測試伺服器的網址。 */
const baseURL = `http://127.0.0.1:${PORT}`;

/** 瀏覽器設定：有 Chrome 用 Chrome，沒有就用內建 chromium。 */
const browserChannel = resolveChromeChannel();

export default defineConfig({
  testDir: './tests/e2e',
  // 失敗時保留 trace 與截圖，方便回報問題
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // CI 上重試一次。背景音情境原先因依賴外部電台串流（somafm）偶發假失敗，
  // 該依賴已改為模擬政策而根除；現況已無已知偶發源，重試留在 CI 作為保險，
  // 日後若連續多輪皆穩定可評估移除。
  retries: process.env.CI ? 1 : 0,
  workers: 4,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: { viewport: { width: 1440, height: 900 }, channel: browserChannel },
      testMatch: [
        '**/home.spec.ts',
        '**/match.spec.ts',
        '**/browse.spec.ts',
        '**/owned.spec.ts',
        '**/bar-music.spec.ts',
        '**/bar-music-gesture.spec.ts',
      ],
    },
    {
      name: 'mobile-375',
      use: { viewport: { width: 375, height: 812 }, channel: browserChannel },
      testMatch: [
        '**/home.spec.ts',
        '**/match.spec.ts',
        '**/browse.spec.ts',
        '**/owned.spec.ts',
        '**/bar-music.spec.ts',
        '**/bar-music-gesture.spec.ts',
      ],
    },
    {
      name: 'responsive',
      use: { viewport: { width: 1440, height: 900 }, channel: browserChannel },
      testMatch: ['**/responsive.spec.ts'],
    },
  ],
  webServer: {
    // --strictPort：埠位被占用時直接失敗，不要默默改用其他埠位。
    // 否則測試會一直等著 baseURL 對應的埠位，最後以逾時收場，
    // 真正的錯誤（埠位衝突）反而被掩蓋。
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: baseURL,
    // 不重用既有伺服器：殘留的 preview 可能指向已被刪除的建置目錄，
    // 對著這樣的頁面執行測試只會得到莫名其妙的失敗。
    // 每次都起新的伺服器，代價是重建置一次（約 30 秒），换来結果可靠。
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
