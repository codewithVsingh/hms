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
      '.claude/**',
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
  // Service boundaries: apps never import each other, packages never import apps.
  // Cross-app communication is via the database (RPC), versioned HTTP, or shared packages only.
  {
    files: ['apps/website/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/portal/**', '**/portal/**', '@hms/portal', '@hms/portal/*'],
              message:
                'The website must not import portal code. Share via packages/* or call the portal over HTTP.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/portal/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/website/**', '**/website/**', '@hms/website', '@hms/website/*'],
              message: 'The portal must not import website code. Share via packages/* instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**', '@hms/portal', '@hms/portal/*', '@hms/website', '@hms/website/*'],
              message: 'Packages must not depend on apps.',
            },
          ],
        },
      ],
    },
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
