/**
 * Node の常駐サーバー（npm run dev / Docker）のエントリ。
 * Cloudflare Workers のエントリは src/worker.ts。
 */
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp, type RateLimiter } from './app.js';
import { config } from './config.js';
import { missingAuthValues, hasLlmConfigured } from './authStore.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 100;

/** IPごとの固定ウィンドウ。単一プロセスなのでメモリで足りる。 */
function memoryRateLimiter(): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (c) => {
    const key = getConnInfo(c).remote.address ?? 'unknown';
    const now = Date.now();
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      // 期限切れの枠を掃除してから作り直す（Map が際限なく伸びないように）
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      window = { count: 0, resetAt: now + WINDOW_MS };
      windows.set(key, window);
    }
    window.count += 1;
    c.header('RateLimit-Limit', String(MAX_REQUESTS));
    c.header('RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - window.count)));
    c.header('RateLimit-Reset', String(Math.ceil((window.resetAt - now) / 1000)));
    return window.count <= MAX_REQUESTS;
  };
}

// 設定漏れは起動時に気づけるようにする（値の解決自体は遅延評価）
const missing = missingAuthValues();
if (missing.length > 0) {
  console.error(`\n⚠️  Spotifyの設定が見つかりません: ${missing.join(', ')}`);
  console.error('   `npm run setup` で対話的に設定できます。\n');
  // 認証ルート有効時は refresh_token を取りに来ている途中なので起動を続ける
  if (!config.server.enableAuthRoutes) process.exit(1);
}

// LLMは任意。未設定でも曲情報は返せるので、案内だけして起動する。
if (!hasLlmConfigured()) {
  console.warn('ℹ️  LLMが未設定のため、AIのムード文なしで動作します。');
  console.warn('   有効にするには `npm run setup` を実行してください。\n');
}

const app = createApp({
  rateLimiter: memoryRateLimiter(),
  // デモフロントエンド + ワンタグ埋め込み用の embed.js
  staticFiles: serveStatic({ root: './public' }),
});

if (config.server.enableAuthRoutes) {
  console.log('⚠️  Auth routes enabled. Visit http://127.0.0.1:' + config.server.port + '/auth/login');
}

const server = serve({ fetch: app.fetch, port: config.server.port }, () => {
  console.log(`🎵 SpotifyEmbedded running on http://localhost:${config.server.port}`);
});

// ポート衝突は開発中によく起きる。スタックトレースではなく対処法を出す。
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ ポート ${config.server.port} はすでに別のプロセスが使用しています。`);
    console.error('   別のポートで起動する:  PORT=3001 npm run dev');
    console.error(`   使用中のプロセスを調べる:  lsof -nP -iTCP:${config.server.port} -sTCP:LISTEN\n`);
    process.exit(1);
  }
  throw err;
});
