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
      // 網羅率を上げるための下限ではなく、テストの無い経路を大きく足す変更を止めるための値。
      // 2026-11-11 の実測（文 80.98%・分岐 77.53%・関数 85.6%・行 82.16%）から4ポイントほど下に置く。
      // 上げ下げするときは、実測値と理由を PR に書く
      thresholds: { statements: 77, branches: 73, functions: 81, lines: 78 },
    },
  },
});
