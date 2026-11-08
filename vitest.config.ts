import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/spec/**/*.test.ts'],
    // support.ts を import し忘れたテストファイルでも、モックと環境変数を残さない
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      // 別プロセスで起動するエントリ（src/index.ts など）も表に出し、テストの補助は数えない
      include: ['src/**/*.ts'],
      exclude: ['src/spec/**', 'src/**/*.d.ts'],
      reporter: ['text', 'html', 'json', 'json-summary'],
    },
  },
});
