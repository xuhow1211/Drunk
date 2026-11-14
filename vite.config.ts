import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite 建置設定。
 *
 * 套用 React 插件（JSX 轉譯與 React Fast Refresh）與 Tailwind CSS v4 插件。
 * 測試區段供 Vitest 使用（純邏輯測試，無需 DOM 環境）。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    // 注入食材對照表索引：ingredients 模組為注入式，同步查詢 API 需先初始化
    setupFiles: ['src/test/setupCatalog.ts'],
    // scripts/*.mjs 為 ESM，其測試也以 .mjs 撰寫（放在 tests/unit/），與 src 測試一起跑。
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.mjs'],
    coverage: {
      // 只統計「可獨立以 node 環境測試」的邏輯層。
      // React 元件需要 DOM 環境，目前改以 Playwright 端對端測試涵蓋，
      // 因此不納入本報告，避免出現大量 0% 造成誤導。
      include: ['src/lib/**/*.ts', 'src/hooks/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.d.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
