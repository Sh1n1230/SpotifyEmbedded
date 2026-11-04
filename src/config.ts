import { requireAuthValue } from './authStore.js';
import { parseCorsOrigins } from './http/cors.js';

function optional_env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * 秘匿値は getter による遅延評価にしている。
 *
 * import した瞬間に必須チェックが走ると、まだ設定が存在しない状態で
 * 実行される `npm run setup` がモジュールの読み込みだけで落ちる。
 * 実際に値を使う時点で初めて解決し、未設定なら次の操作を案内する。
 *
 * 解決順は authStore が持つ（環境変数 → data/auth.json）。環境変数が
 * 最優先なので、.env だけで運用している既存の構成は挙動が変わらない。
 */
export const config = {
  spotify: {
    get clientId(): string {
      return requireAuthValue('spotifyClientId');
    },
    get clientSecret(): string {
      return requireAuthValue('spotifyClientSecret');
    },
    get refreshToken(): string {
      return requireAuthValue('spotifyRefreshToken');
    },
    get redirectUri(): string {
      return optional_env('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback');
    },
  },
  // LLM の設定（送り先・キー・モデル）は src/llm/settings.ts の resolveLlm() が決める
  server: {
    get port(): number {
      return parseInt(optional_env('PORT', '3000'), 10);
    },
    /** 許可するオリジン。CORS_ORIGIN はカンマ区切りで複数書ける。未設定なら ['*']。 */
    get corsOrigins(): string[] {
      return parseCorsOrigins(process.env['CORS_ORIGIN']);
    },
    /**
     * レート制限のキーに使うクライアントIPのヘッダー（例: fly-client-ip, x-forwarded-for）。
     * プロキシ配下では接続元が全員プロキシになり1つの枠を共有してしまう。ただし
     * ヘッダーは偽装できるので、プロキシが必ず上書きする構成でだけ設定すること。
     */
    get trustedProxyHeader(): string | null {
      return process.env['TRUSTED_PROXY_HEADER']?.trim().toLowerCase() || null;
    },
    get enableAuthRoutes(): boolean {
      return optional_env('ENABLE_AUTH_ROUTES', 'false') === 'true';
    },
  },
};
