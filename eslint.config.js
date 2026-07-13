import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const tsFiles = ['apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts', 'Scripts/v2/**/*.ts'];

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'apps/docs/.docusaurus/**', 'tools/**', 'docs/**', 'osdcloud-assets/**'],
  },
  js.configs.recommended,
  {
    files: ['Scripts/v2/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' },
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: tsFiles })),
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
];
