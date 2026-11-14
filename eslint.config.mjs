// Root ESLint flat config for the @ngo/* monorepo.
// Two project-wide guards (constitution Principle V, research R15):
//   1. No literal JSX text in apps/web — every label comes from messages/ar.json + en.json.
//   2. No ad-hoc locale formatting — dates go through packages/shared/src/format/date.ts.
import { fixupPluginRules } from '@eslint/compat';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DATE_FORMATTER_FILE = 'packages/shared/src/format/date.ts';

const localeFormattingBan = {
  'no-restricted-properties': [
    'error',
    {
      property: 'toLocaleDateString',
      message: `Format dates with formatDate() from @ngo/shared (${DATE_FORMATTER_FILE}).`,
    },
    {
      property: 'toLocaleTimeString',
      message: `Format times with formatDateTime() from @ngo/shared (${DATE_FORMATTER_FILE}).`,
    },
    {
      property: 'toLocaleString',
      message:
        'Locale-dependent formatting is banned: use formatDate()/formatDateTime() or the money helpers from @ngo/shared.',
    },
    {
      object: 'Intl',
      property: 'DateTimeFormat',
      message: `Intl.DateTimeFormat is only allowed in ${DATE_FORMATTER_FILE}.`,
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.min.js',
      'packages/database/src/types.ts',
      'supabase/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      ...localeFormattingBan,
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/prop-types': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    // fixupPluginRules: the Next 14 plugin still calls ESLint 8 context APIs.
    plugins: { '@next/next': fixupPluginRules(nextPlugin) },
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // App Router only: there is no pages/ directory.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    // i18n: user-visible text must come from next-intl messages.
    files: ['apps/web/src/**/*.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: [
            '·',
            '•',
            '-',
            '–',
            '—',
            '/',
            ':',
            '|',
            '(',
            ')',
            '*',
            '%',
            '#',
            '+',
            '×',
            '…',
            ',',
            '.',
          ],
        },
      ],
    },
  },
  {
    // The single place allowed to touch Intl date APIs.
    files: [DATE_FORMATTER_FILE],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/tests/**', '**/e2e/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.{cjs,js}'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  }
);
