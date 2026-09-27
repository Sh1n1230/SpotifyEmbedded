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
import { createApp, type RateLimiter } from './app.js';
import { setDurableStore, type DurableStore } from './cache/index.js';

interface Env {
  /** ムード文の保存先。isolate が入れ替わっても LLM を呼び直さないため。 */
  MOODS?: KVNamespace;
  RATE_LIMITER?: RateLimit;
}

function kvStore(kv: KVNamespace): DurableStore {
  return {
    get: <T>(key: string) => kv.get<T>(key, 'json'),
    put: (key, value, ttlSeconds) =>
      kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined),
  };
}

function bindingRateLimiter(binding: RateLimit): RateLimiter {
  return async (c) => {
    const key = c.req.header('cf-connecting-ip') ?? 'unknown';
    const { success } = await binding.limit({ key });
    return success;
  };
}

let app: ReturnType<typeof createApp> | null = null;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    // バインディングは isolate 内で不変なので、最初のリクエストで一度だけ組み立てる
    if (!app) {
      setDurableStore(env.MOODS ? kvStore(env.MOODS) : null);
      app = createApp({
        rateLimiter: env.RATE_LIMITER ? bindingRateLimiter(env.RATE_LIMITER) : undefined,
      });
    }
    return app.fetch(request, env, ctx);
  },
};
