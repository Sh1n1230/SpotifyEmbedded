import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/spec/**/*.test.ts'],
    // support.ts を import し忘れたテストファイルでも、モックと環境変数を残さない
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
