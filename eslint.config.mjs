// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      'review/**',
      'scripts/review-vendor/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Existing screens load data and reset local state inside effects; keep these visible
      // as warnings to refactor gradually rather than blocking CI.
      'react-hooks/set-state-in-effect': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs['core-web-vitals'].rules },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Offline QA preview harness that runs in the browser.
    files: ['scripts/review-hook-adapter.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { '@typescript-eslint/no-this-alias': 'off' },
  },
  {
    files: ['apps/portal/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  prettier,
);
