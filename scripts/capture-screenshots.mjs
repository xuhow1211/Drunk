/**
 * 瀏覽器驗收截圖產生腳本。
 *
 * 以真實瀏覽器走完「首頁 → 手邊材料 → 挑調酒 → 看做法」動線，
 * 將各畫面存成 PNG 作為驗收證據（輸出到 docs/screenshots/）。
 *
 * 執行方式：npm run screenshots
 * 腳本會自行建置專案並啟動預覽伺服器，結束後自動關閉。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/** 專案根目錄。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 截圖輸出目錄。 */
const OUTPUT_DIR = path.join(ROOT, 'docs', 'screenshots');

/** 預覽伺服器的連接埠。 */
const PORT = Number(process.env.E2E_PORT ?? 4173);

/** 預覽伺服器的網址。 */
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** 單張截圖的體積上限（bytes）；超過時會重新編碼縮小。 */
const MAX_BYTES = 500 * 1024;

/** 重新編碼時使用的色彩深度（每個色channel 位元數），4 位元＝4096 色。 */
const COLOR_BITS = 4;

/** 各作業系統常見的 Chrome 安裝位置。 */
const CHROME_PATHS = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
};

/**
 * 判斷本機是否安裝了 Chrome；安裝了才使用 channel: 'chrome'。
 *
 * @returns {'chrome'|undefined} 瀏覽器通道
 */
function resolveChromeChannel() {
  const candidates = CHROME_PATHS[process.platform] ?? [];
  return candidates.some((item) => item.length > 0 && existsSync(item)) ? 'chrome' : undefined;
}

/**
 * 以 child_process 執行 npm 指令。
 *
 * @param {string[]} args npm 指令參數
 * @param {import('node:child_process').StdioOptions} [stdio] 子行程的標準串流設定
 * @returns {import('node:child_process').ChildProcess} 子行程
 */
function runNpm(args, stdio = 'inherit') {
  return spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: ROOT,
    stdio,
    shell: process.platform === 'win32',
  });
}

/**
 * 結束子行程及其衍生的子行程。
 *
 * Windows 上 `npm.cmd` 只是 vite 的啟動器，直接 kill 只會留下 vite 本身佔用連接埠，
 * 因此改用 taskkill /T 一次結束整棵行程樹。
 *
 * @param {import('node:child_process').ChildProcess | undefined} child 子行程
 */
function killProcessTree(child) {
  if (!child || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

/**
 * 等待預覽伺服器回應。
 *
 * @param {number} timeout 逾時毫秒數
 */
async function waitForServer(timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL, { redirect: 'follow' });
      if (response.ok) return;
    } catch {
      // 伺服器尚未就緒，稍後再試
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`預覽伺服器在 ${timeout} 毫秒內沒有就緒：${BASE_URL}`);
}

/**
 * 等待動畫與進場效果結束，避免截到動畫中途的畫面。
 *
 * @param {import('@playwright/test').Page} page 頁面
 * @param {number} ms 等待毫秒數
 */
async function settle(page, ms = 900) {
  await page.waitForTimeout(ms);
}

/**
 * 勾選材料（以搜尋框找到並點擊晶片）。
 *
 * @param {import('@playwright/test').Page} page 頁面
 * @param {string} name 材料中文名稱
 */
async function selectIngredient(page, name) {
  const search = page.getByRole('searchbox', { name: '搜尋材料' });
  await search.fill(name);
  const chip = page.getByRole('button', { name, exact: true });
  await chip.waitFor({ state: 'visible' });
  await chip.click();
  await settle(page, 400);
}

/**
 * 將過大的 PNG 以較低色彩深度重新編碼，縮小檔案體積。
 *
 * 暗色介面的噪點紋理讓 PNG 難以壓縮，因此改用 4 位元色彩深度（4096 色）
 * 重新編碼；視覺差異極小，但檔案可縮小三成以上。
 *
 * @param {import('@playwright/test').Page} processor 空白處理頁面
 * @param {string} file 圖檔路徑
 * @returns {Promise<boolean>} 是否有重新編碼
 */
async function optimizePng(processor, file) {
  const info = await stat(file);
  if (info.size <= MAX_BYTES) return false;

  const buffer = await readFile(file);
  const source = `data:image/png;base64,${buffer.toString('base64')}`;

  const encoded = await processor.evaluate(
    async ({ src, bits }) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = src;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = data.data;
      const shift = 8 - bits;
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = (pixels[index] >> shift) << shift;
        pixels[index + 1] = (pixels[index + 1] >> shift) << shift;
        pixels[index + 2] = (pixels[index + 2] >> shift) << shift;
      }
      context.putImageData(data, 0, 0);
      return canvas.toDataURL('image/png');
    },
    { src: source, bits: COLOR_BITS },
  );

  await writeFile(file, Buffer.from(encoded.split(',')[1] ?? '', 'base64'));
  return true;
}

/**
 * 擷取畫面並存檔。
 *
 * @param {import('@playwright/test').Page} page 頁面
 * @param {import('@playwright/test').Page} processor 圖片處理頁面
 * @param {string} name 檔名（不含副檔名）
 */
async function capture(page, processor, name) {
  const file = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  const shrunk = await optimizePng(processor, file);
  const info = await stat(file);
  console.log(`已存檔：${path.relative(ROOT, file)}（${Math.round(info.size / 1024)} KB${shrunk ? '，已重新編碼' : ''}）`);
}

/**
 * 主流程。
 */
async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log('建置專案中...');
  await new Promise((resolve, reject) => {
    const build = runNpm(['run', 'build']);
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`建置失敗（代碼 ${code}）`)),
    );
  });

  console.log('啟動預覽伺服器...');
  // 預覽伺服器的輸出改成 pipe 並且抽乾，避免它佔住父行程的 stdout 造成管線卡住。
  const server = runNpm(
    ['run', 'preview', '--', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
    ['ignore', 'pipe', 'pipe'],
  );
  server.stdout?.resume();
  server.stderr?.resume();

  const browser = await chromium.launch({ channel: resolveChromeChannel() });
  // 圖片處理用的空白頁面（用於重新編碼過大的 PNG）
  const processor = await browser.newPage();

  try {
    await waitForServer();

    // 桌面版（1440x900）
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktop.newPage();

    // 首頁主視覺
    await page.goto(`${BASE_URL}/`);
    await settle(page, 1600);
    await capture(page, processor, 'home-hero-1440');

    // 首頁捲動到三入口卡與精選熱選區
    const featured = page.getByRole('region', { name: '精選熱選' });
    await featured.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -320));
    await settle(page, 1200);
    await capture(page, processor, 'home-scrolled-1440');

    // 比對模式：未選材料
    await page.goto(`${BASE_URL}/match`);
    await settle(page, 1200);
    await capture(page, processor, 'match-empty-1440');

    // 比對模式：已選材料
    await selectIngredient(page, '伏特加');
    await selectIngredient(page, '柳橙汁');
    await settle(page, 1200);
    await capture(page, processor, 'match-filled-1440');

    // 瀏覽模式：經典調酒
    await page.goto(`${BASE_URL}/classic`);
    await settle(page, 1400);
    await capture(page, processor, 'browse-classic-1440');

    // 瀏覽模式：篩選後
    const filterBar = page.getByRole('region', { name: '篩選與排序' });
    await filterBar.getByRole('button', { name: '高球類 Highball' }).click();
    await settle(page, 1200);
    await capture(page, processor, 'browse-filtered-1440');

    // 配方詳情抽屜
    await page.goto(`${BASE_URL}/classic`);
    await settle(page, 1200);
    await page.locator('button[data-recipe-id]').first().click();
    await settle(page, 1200);
    await capture(page, processor, 'drawer-1440');
    await desktop.close();

    // 行動版（375x812）
    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobilePage = await mobile.newPage();

    await mobilePage.goto(`${BASE_URL}/`);
    await settle(mobilePage, 1600);
    await capture(mobilePage, processor, 'home-hero-375');

    await mobilePage.goto(`${BASE_URL}/match`);
    await settle(mobilePage, 1200);
    await selectIngredient(mobilePage, '伏特加');
    await selectIngredient(mobilePage, '柳橙汁');
    await settle(mobilePage, 1200);
    await capture(mobilePage, processor, 'match-filled-375');

    await mobilePage.goto(`${BASE_URL}/classic`);
    await settle(mobilePage, 1200);
    await mobilePage.locator('button[data-recipe-id]').first().click();
    await settle(mobilePage, 1200);
    await capture(mobilePage, processor, 'drawer-375');
    await mobile.close();
  } finally {
    await browser.close();
    killProcessTree(server);
  }

  console.log('截圖完成。');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
