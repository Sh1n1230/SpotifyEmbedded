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
import nowPlayingRouter from './routes/nowPlaying.js';
import authRouter from './routes/auth.js';
import embedRouter from './routes/embed.js';

/** リクエストを通してよければ true。 */
export type RateLimiter = (c: Context) => Promise<boolean>;

export interface AppOptions {
  rateLimiter?: RateLimiter;
  /** Node では静的ファイル（public/）をここで配る。Workers は Static Assets が先に応答する。 */
  staticFiles?: Parameters<Hono['use']>[1];
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  // セキュリティヘッダー
  app.use(async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    // /embed は他サイトの iframe に埋め込んでもらうためのページなので、
    // ここだけフレーム禁止を外す。API・デモ画面は DENY のまま。
    if (c.req.path !== '/embed') c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
  });

  // CORS_ORIGIN は Workers では環境変数がリクエスト時に解決されるため、毎回読む
  app.use((c, next) => cors({ origin: config.server.corsOrigin })(c, next));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  if (options.rateLimiter) {
    const limiter = options.rateLimiter;
    app.use(async (c, next) => {
      if (!(await limiter(c))) {
        return c.json({ error: 'Too many requests, please try again later.' }, 429);
      }
      await next();
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
