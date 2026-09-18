import 'dotenv/config';
import { requireAuthValue } from './authStore.js';

function optional_env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * 秘匿値は getter による遅延評価にしている。
 *
 * import した瞬間に必須チェックが走ると、まだ認証情報が存在しない状態で
 * 実行される `spotify-embedded setup` がモジュールの読み込みだけで落ちる。
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
  groq: {
    get apiKey(): string {
      return requireAuthValue('groqApiKey');
    },
    get model(): string {
      return optional_env('GROQ_MODEL', 'llama-3.3-70b-versatile');
    },
  },
  server: {
    get port(): number {
      return parseInt(optional_env('PORT', '3000'), 10);
    },
    get corsOrigin(): string {
      return optional_env('CORS_ORIGIN', '*');
    },
    get enableAuthRoutes(): boolean {
      return optional_env('ENABLE_AUTH_ROUTES', 'false') === 'true';
    },
  },
};
