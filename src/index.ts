/**
 * Node の常駐サーバー（npm run dev / Docker）のエントリ。
 * Cloudflare Workers のエントリは src/worker.ts。
 */
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from './app.js';
import { config } from './config.js';
import { missingAuthValues } from './authStore.js';
import { llmKeyNotice, resolveLlm } from './llm/settings.js';
import { clientKey, memoryRateLimiter, warnIfUnknown } from './http/rateLimit.js';
import { analyzeCorsOrigins, openCorsWarning } from './http/cors.js';
import { portInUseHelp } from './http/portInUse.js';
import { DEMO_PAGE_CSP, EMBED_SCRIPT_CACHE_CONTROL } from './http/securityHeaders.js';

// PORT の誤り（abc・3000abc・0 など）は、スタックトレースではなく直し方を出して終える
let port: number;
try {
  port = config.server.port;
} catch (err) {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

// 設定漏れは起動時に気づけるようにする（値の解決自体は遅延評価）
const missing = missingAuthValues();
if (missing.length > 0) {
  console.error(`\n⚠️  Spotifyの設定が見つかりません: ${missing.join(', ')}`);
  console.error('   `npm run setup` で対話的に設定できます。\n');
  // 認証ルート有効時は refresh_token を取りに来ている途中なので起動を続ける。
  // ただし Client ID / Secret が無ければ /auth/login も動かないので、続ける意味が無い
  const onlyRefreshTokenMissing = missing.every((name) => name === 'SPOTIFY_REFRESH_TOKEN');
  if (!config.server.enableAuthRoutes || !onlyRefreshTokenMissing) process.exit(1);
}

// LLMは任意。未設定でも曲情報は返せるので、案内だけして起動する。
const llm = resolveLlm();
if (llm.kind === 'unconfigured') {
  console.warn('ℹ️  LLMが未設定のため、AIのムード文なしで動作します。');
  console.warn('   有効にするには `npm run setup` を実行してください。\n');
} else if (llm.kind === 'invalid') {
  console.warn(`⚠️  ${llm.problem}`);
  console.warn('   設定を直すまで、AIのムード文なしで動作します。\n');
}
const llmNotice = llmKeyNotice();
if (llmNotice) console.warn(`ℹ️  ${llmNotice}\n`);

// ローカル開発では * のままでよいので、本番相当（NODE_ENV=production、Docker の既定）でだけ警告する
const corsWarning = process.env['NODE_ENV'] === 'production' ? openCorsWarning(config.server.corsOrigins) : null;
if (corsWarning) console.warn(`⚠️  ${corsWarning}\n`);
for (const problem of analyzeCorsOrigins(process.env['CORS_ORIGIN']).problems) console.warn(`⚠️  ${problem}\n`);

const app = createApp({
  rateLimiter: memoryRateLimiter({
    key: (c) => {
      const key = clientKey(c, config.server.trustedProxyHeader, (ctx) => getConnInfo(ctx).remote.address);
      warnIfUnknown(key);
      return key;
    },
  }),
  // デモフロントエンド + ワンタグ埋め込み用の embed.js。
  // デモ画面の CSP は Workers の public/_headers と同じ値（src/http/securityHeaders.ts）
  // 作業ディレクトリではなく、このファイルの位置から public/ を決める（src/index.ts と dist/index.js の
  // どちらから、どこで起動しても同じ場所を指す）
  staticFiles: serveStatic({
    root: fileURLToPath(new URL('../public', import.meta.url)),
    onFound: (path, c) => {
      if (path.endsWith('.html')) c.header('Content-Security-Policy', DEMO_PAGE_CSP);
      if (path.endsWith('/embed.js')) c.header('Cache-Control', EMBED_SCRIPT_CACHE_CONTROL);
    },
  }),
});

if (config.server.enableAuthRoutes) {
  console.log(`⚠️  Auth routes enabled. Visit ${new URL('/auth/login', config.spotify.redirectUri).href}`);
  console.log(`   Redirect URI: ${config.spotify.redirectUri}（Spotify の Dashboard の登録値と一致させてください）`);
}

const hostname = config.server.host;
const server = serve({ fetch: app.fetch, port, ...(hostname ? { hostname } : {}) }, () => {
  console.log(`🎵 SpotifyEmbedded running on http://127.0.0.1:${port}`);
});

// ポート衝突は開発中によく起きる。スタックトレースではなく対処法を出す。
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    const script = process.env['npm_lifecycle_event'] ?? 'dev';
    console.error(`\n${portInUseHelp(port, process.platform, script).join('\n')}\n`);
    process.exit(1);
  }
  throw err;
});

/** 処理中のリクエストを待つ上限。超えたら強制終了する（docker stop の既定の猶予は10秒）。 */
const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Docker では Node が PID 1 になり、ハンドラの無い SIGTERM / SIGINT では終了しない
 * （docker stop が猶予時間いっぱい待たされ、SIGKILL で切られる）。
 * https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#handling-kernel-signals
 *
 * 新規の接続を止め、処理中のリクエストが終わったら終了する。
 */
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  // 2回目のシグナル（Ctrl-C の連打など）は待たずに止める
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log('終了します:', signal);
  server.close(() => process.exit(0));
  setTimeout(() => {
    console.error('処理中のリクエストが終わらないため、強制終了します。');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
