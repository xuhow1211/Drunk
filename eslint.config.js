import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * ESLint 扁平化設定（ESLint 9）。
 *
 * 規則分級：型別錯誤與未使用變數視為 error，其餘為 warn。
 */
export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules', 'src/data'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      // 腳本本身跑在 Node，但 page.evaluate 的回呼是在瀏覽器執行，
      // 因此一併掛上瀏覽器全域變數（Image、document、window 等）。
      globals: { ...globals.node, ...globals.browser },
      sourceType: 'module',
    },
  },
);
