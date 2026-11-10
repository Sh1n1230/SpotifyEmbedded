/**
 * Cloudflare Workers のエントリ。設定は wrangler.jsonc。
 *
 * public/ は Static Assets として Worker より先に配信される（ヘッダーは
 * public/_headers）。ここに届くのは API と埋め込み用のパスだけ。
 *
 * 秘密情報は `wrangler secret put` で設定する。nodejs_compat により
 * process.env に入るので、config.ts はそのまま使える。
 */
import type { ExecutionContext, KVNamespace, RateLimit } from '@cloudflare/workers-types';
import { createApp } from './app.js';
import { bindingRateLimiter } from './http/rateLimit.js';
import { analyzeCorsOrigins, openCorsWarning } from './http/cors.js';
import { config } from './config.js';
import { setDurableStore, type DurableStore } from './cache/index.js';
import { MissingConfigError, missingAuthValues } from './authStore.js';
import { setShareInFlightWork } from './runtime.js';

interface Env {
  /** ムード文の保存先。isolate が入れ替わっても LLM を呼び直さないため。 */
  MOODS?: KVNamespace;
  RATE_LIMITER?: RateLimit;
}

function kvStore(kv: KVNamespace): DurableStore {
  return {
    get: (key: string) => kv.get(key, 'json'),
    put: (key, value, ttlSeconds) =>
      kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: Math.max(ttlSeconds, 60) } : undefined),
  };
}

let app: ReturnType<typeof createApp> | null = null;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    // バインディングは isolate 内で不変なので、最初のリクエストで一度だけ組み立てる
    if (!app) {
      setDurableStore(env.MOODS ? kvStore(env.MOODS) : null);
      // あるリクエストが作った Promise を別のリクエストに待たせない（理由は src/runtime.ts）
      setShareInFlightWork(false);
      // Secrets の入れ忘れは、最初のリクエストで分かるようにする（Node 版の起動時の確認にあたる）。
      // リクエストは止めない: /health と失敗時のカードは Secrets が無くても返せる
      const missing = missingAuthValues();
      if (missing.length > 0) console.error('[config]', new MissingConfigError(missing).message);
      // Workers は本番として扱う。isolate ごとに一度だけ出る
      const corsWarning = openCorsWarning(config.server.corsOrigins);
      if (corsWarning) console.warn(corsWarning);
      for (const problem of analyzeCorsOrigins(process.env['CORS_ORIGIN']).problems) console.warn(problem);
      app = createApp(env.RATE_LIMITER ? { rateLimiter: bindingRateLimiter(env.RATE_LIMITER) } : {});
    }
    return app.fetch(request, env, ctx);
  },
};
