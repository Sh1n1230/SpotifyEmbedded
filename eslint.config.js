// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['dist/', 'out/', 'data/', '.wrangler/', 'coverage/'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // ブラウザにそのまま配る ES5 のスクリプト（TypeScript の対象外）
  {
    files: ['public/**/*.js'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      globals: globals.browser,
    },
  },
  // この設定ファイルなど、Node で動く ES Modules
  {
    files: ['*.js'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
);
