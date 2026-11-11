/**
 * ライブAPIの本体。Node（src/index.ts）と Cloudflare Workers（src/worker.ts）の
 * 両方がこれを使う。
 *
 * 扱うのは now-playing だけ。ランキングは数週間〜1年の集計で、秒単位の
 * 鮮度が要らないので静的モード（GitHub Actions）に任せている。実行環境ごとの違い（静的ファイルの配信、レート制限の
 * 実装、KV の有無）はエントリ側が注入する。
 */
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { handleError, sendError } from './http/respond.js';
import { RATE_LIMIT, type RateLimiter } from './http/rateLimit.js';
import {
  CROSS_ORIGIN_RESOURCE_POLICY,
  EMBEDDABLE_PATHS,
  HSTS,
  PERMISSIONS_POLICY,
} from './http/securityHeaders.js';
import { VERSION } from './version.js';
import nowPlayingRouter from './routes/nowPlaying.js';
import authRouter from './routes/auth.js';
import embedRouter, { rateLimitedEmbedResponse } from './routes/embed.js';

export type { RateLimiter } from './http/rateLimit.js';

export interface AppOptions {
  rateLimiter?: RateLimiter;
  /** Node では静的ファイル（public/）をここで配る。Workers は Static Assets が先に応答する。 */
  staticFiles?: Parameters<Hono['use']>[1];
  /**
   * 応答のたびに呼ぶ（アクセスログ用。Node のエントリが渡す）。クエリと接続元は渡さない。
   * ここで投げた例外は応答に影響させない。
   */
  onResponse?: (info: { method: string; path: string; status: number; durationMs: number }) => void;
}

/** 他オリジンの JavaScript から読めるようにするレスポンスヘッダー（Access-Control-Expose-Headers）。 */
const EXPOSED_HEADERS = [
  'Retry-After',
  'RateLimit-Policy',
  'RateLimit',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'X-Spotify-Embedded-Error',
];

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  if (options.onResponse) {
    const onResponse = options.onResponse;
    app.use(async (c, next) => {
      const startedAt = Date.now();
      await next();
      try {
        onResponse({ method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - startedAt });
      } catch {
        // ログの失敗で応答を落とさない
      }
    });
  }

  // セキュリティヘッダー（一覧は src/http/securityHeaders.ts）
  app.use(async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    // /embed は他サイトの iframe に埋め込んでもらうためのページなので、
    // ここだけフレーム禁止を外す。API・デモ画面は DENY のまま。
    if (c.req.path !== '/embed') c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', PERMISSIONS_POLICY);
    if (EMBEDDABLE_PATHS.includes(c.req.path)) {
      c.header('Cross-Origin-Resource-Policy', CROSS_ORIGIN_RESOURCE_POLICY);
    }
    // TLS を終端するプロキシの裏にいる Node 版では http に見えるので、そのときはプロキシ側で付ける
    if (new URL(c.req.url).protocol === 'https:') c.header('Strict-Transport-Security', HSTS);
  });

  // CORS_ORIGIN は Workers では環境変数がリクエスト時に解決されるため、毎回読む。
  // 複数書かれていれば、リクエストの Origin が一覧にあるときだけそれを返す。
  // 値はリクエストのたびに読むが（Workers の環境変数のため）、ミドルウェアは値が変わったときだけ作り直す
  let corsKey: string | null = null;
  let corsMiddleware: ReturnType<typeof cors> | null = null;
  app.use((c, next) => {
    const origins = config.server.corsOrigins;
    const key = origins.join(',');
    if (key !== corsKey || !corsMiddleware) {
      corsKey = key;
      corsMiddleware = cors({
        origin: origins.length === 1 ? (origins[0] ?? '*') : origins,
        // ルートは GET（と HEAD）だけ。実装していないメソッドを他オリジンに許可しない
        allowMethods: ['GET', 'HEAD', 'OPTIONS'],
        // CORS で安全とされるヘッダー以外は、ここに書かないと他オリジンの JavaScript から読めない
        exposeHeaders: EXPOSED_HEADERS,
      });
    }
    return corsMiddleware(c, next);
  });

  // version は package.json の版。公開リポジトリの版なので、外から見えて困る情報ではない
  app.get('/health', (c) => c.json({ status: 'ok', version: VERSION }));

  // 静的ファイル（デモ画面・embed.js）はレート制限より前に配り、数えない。Spotify も LLM も呼ばないので守る対象ではなく、
  // Workers の Static Assets（Worker より先に応答する）とも揃う
  if (options.staticFiles) app.use(options.staticFiles);

  if (options.rateLimiter) {
    const limiter = options.rateLimiter;
    app.use(async (c, next) => {
      const decision = await limiter(c);
      // 残り回数が分かる実装（Node）だけが付ける。
      // RateLimit-Policy / RateLimit は現行の草案 draft-ietf-httpapi-ratelimit-headers-11 の形
      // （Structured Fields。q=上限、w=期間の秒、r=残り、t=回復までの秒）。
      // RateLimit-Limit / -Remaining / -Reset は draft-03 以前の3分割の形で、移行のために併記している
      if (decision.remaining !== undefined) {
        c.header('RateLimit-Policy', `"default";q=${RATE_LIMIT.limit};w=${RATE_LIMIT.windowSeconds}`);
        c.header('RateLimit', `"default";r=${decision.remaining};t=${decision.retryAfterSeconds}`);
        c.header('RateLimit-Limit', String(RATE_LIMIT.limit));
        c.header('RateLimit-Remaining', String(decision.remaining));
        c.header('RateLimit-Reset', String(decision.retryAfterSeconds));
      }
      if (!decision.allowed) return rateLimited(c, decision.retryAfterSeconds);
      return next();
    });
  }

  app.route('/api/now-playing', nowPlayingRouter);

  // /embed, /badge.svg
  app.route('/', embedRouter);

  if (config.server.enableAuthRoutes) app.route('/auth', authRouter);

  app.onError(handleError);
  // 未定義のパスも、ほかのエラーと同じく JSON で返す。ランキングはライブAPIでは出さない（静的モード専用）
  app.notFound((c) =>
    sendError(
      c,
      404,
      'not_found',
      'Not found',
      c.req.path.startsWith('/api/top-tracks')
        ? { hint: 'ランキングは静的モード（top-tracks.json）でだけ提供しています' }
        : {}
    )
  );

  return app;
}

/**
 * 429 の応答。Spotify は呼ばない（レート制限の目的を保つ）。Node・Workers とも同じ形にする。
 * /badge.svg と /embed は JSON を描けないので、それぞれのカードを返す（src/routes/embed.ts）。
 */
function rateLimited(c: Context, retryAfterSeconds: number): Response {
  c.header('Retry-After', String(retryAfterSeconds));
  c.header('Cache-Control', 'no-store');
  return (
    rateLimitedEmbedResponse(c) ??
    sendError(c, 429, 'rate_limited', 'Too many requests, please try again later.')
  );
}
