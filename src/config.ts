import { requireAuthValue } from './authStore.js';
import { parseCorsOrigins } from './http/cors.js';

/** ポートの既定値 */
const DEFAULT_PORT = 3000;
/** TCP のポート番号の上限 */
const MAX_PORT = 65535;

/** PORT を読む。1〜65535 の整数でなければ、何が悪いかを示して throw する（3000abc を 3000 として読まない）。 */
export function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`PORT は 1〜${MAX_PORT} の整数で指定してください（今の値: ${value}）`);
  }
  return port;
}

/** now-playing のキャッシュの秒数の既定値と、受け付ける範囲 */
export const NOW_PLAYING_CACHE = { defaultSeconds: 30, minSeconds: 5, maxSeconds: 300 } as const;
const warnedCacheSeconds = new Set<string>();

/**
 * NOW_PLAYING_CACHE_SECONDS を読む。5〜300 の整数。範囲の外は近い端に丸め、読めない値は既定の 30 にして、
 * どちらも一度だけ警告する。下限は Spotify を叩きすぎないため、上限は「再生中」の表示が古くなりすぎないため。
 */
export function parseNowPlayingCacheSeconds(value: string | undefined): number {
  const raw = value?.trim() ?? '';
  if (raw === '') return NOW_PLAYING_CACHE.defaultSeconds;
  const { defaultSeconds, minSeconds, maxSeconds } = NOW_PLAYING_CACHE;
  const seconds = /^\d+$/.test(raw) ? Math.min(Math.max(Number(raw), minSeconds), maxSeconds) : defaultSeconds;
  if (String(seconds) !== raw && !warnedCacheSeconds.has(raw)) {
    warnedCacheSeconds.add(raw);
    console.warn(
      `NOW_PLAYING_CACHE_SECONDS は ${minSeconds}〜${maxSeconds} の整数で指定してください（今の値: ${raw}。${seconds} 秒として扱います）`
    );
  }
  return seconds;
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
    /** npm run setup の一時サーバーが受ける Redirect URI。未設定なら PORT から組み立てる。Dashboard の登録値と一致させること */
    get redirectUri(): string {
      return (
        process.env['SPOTIFY_REDIRECT_URI'] ||
        `http://127.0.0.1:${parsePort(process.env['PORT'])}/auth/callback`
      );
    },
  },
  // LLM の設定（送り先・キー・モデル）は src/llm/settings.ts の resolveLlm() が決める
  server: {
    get port(): number {
      return parsePort(process.env['PORT']);
    },
    /** 待ち受けるホスト。HOST が無ければすべてのインターフェース（Docker で必要）。 */
    get host(): string | undefined {
      return process.env['HOST']?.trim() || undefined;
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
    /** now-playing をメモリに保持する秒数（ライブAPI）。この間は Spotify を呼ばない */
    get nowPlayingCacheSeconds(): number {
      return parseNowPlayingCacheSeconds(process.env['NOW_PLAYING_CACHE_SECONDS']);
    },
  },
};
