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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
