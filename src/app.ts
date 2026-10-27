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
import { handleError } from './http/respond.js';
import { RATE_LIMIT, type RateLimiter } from './http/rateLimit.js';
import { HSTS, PERMISSIONS_POLICY } from './http/securityHeaders.js';
import nowPlayingRouter from './routes/nowPlaying.js';
import authRouter from './routes/auth.js';
import embedRouter, { rateLimitedEmbedResponse } from './routes/embed.js';

export type { RateLimiter } from './http/rateLimit.js';

export interface AppOptions {
  rateLimiter?: RateLimiter;
  /** Node では静的ファイル（public/）をここで配る。Workers は Static Assets が先に応答する。 */
  staticFiles?: Parameters<Hono['use']>[1];
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  // セキュリティヘッダー（一覧は src/http/securityHeaders.ts）
  app.use(async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    // /embed は他サイトの iframe に埋め込んでもらうためのページなので、
    // ここだけフレーム禁止を外す。API・デモ画面は DENY のまま。
    if (c.req.path !== '/embed') c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', PERMISSIONS_POLICY);
    // TLS を終端するプロキシの裏にいる Node 版では http に見えるので、そのときはプロキシ側で付ける
    if (new URL(c.req.url).protocol === 'https:') c.header('Strict-Transport-Security', HSTS);
  });

  // CORS_ORIGIN は Workers では環境変数がリクエスト時に解決されるため、毎回読む。
  // 複数書かれていれば、リクエストの Origin が一覧にあるときだけそれを返す。
  app.use((c, next) => {
    const origins = config.server.corsOrigins;
    return cors({ origin: origins.length === 1 ? (origins[0] ?? '*') : origins })(c, next);
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  if (options.rateLimiter) {
    const limiter = options.rateLimiter;
    app.use(async (c, next) => {
      const decision = await limiter(c);
      // 残り回数が分かる実装（Node）だけが付ける。形は IETF の RateLimit ヘッダーの草案に沿う
      if (decision.remaining !== undefined) {
        c.header('RateLimit-Limit', String(RATE_LIMIT.limit));
        c.header('RateLimit-Remaining', String(decision.remaining));
        c.header('RateLimit-Reset', String(decision.retryAfterSeconds));
      }
      if (!decision.allowed) return rateLimited(c, decision.retryAfterSeconds);
      return next();
    });
  }

  if (options.staticFiles) app.use(options.staticFiles);

  app.route('/api/now-playing', nowPlayingRouter);

  // /embed, /badge.svg
  app.route('/', embedRouter);

  if (config.server.enableAuthRoutes) app.route('/auth', authRouter);

  app.onError(handleError);

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
    c.json({ error: 'Too many requests, please try again later.' }, 429)
  );
}
