import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.next/**',
      '**/out/**',
      '**/*.d.ts',
      'eslint.config.js',
      '.dependency-cruiser.cjs',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        // The web app has its own tsconfig (DOM types, JSX); everything else uses the root one.
        project: ['./tsconfig.json', './apps/web/tsconfig.json'],
      },
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint, prettier },
    rules: {
      ...js.configs.recommended.rules,
      // Turns off core rules the TypeScript compiler already checks (no-undef, no-redeclare...).
      ...tseslint.configs['eslint-recommended'].overrides[0].rules,
      ...tseslint.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.tsx', 'apps/web/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs['recommended-latest'].rules },
  },
];
