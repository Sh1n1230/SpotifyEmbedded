/**
 * ライブAPIのレート制限。数え方は実行環境ごとに違う（Node はメモリ、Workers は
 * RATE_LIMITER バインディング）が、キーの作り方・上限・429 の形はここで揃える。
 *
 * このモジュールは副作用を持たず、Node 専用の import もしない（Workers からも読むため）。
 */
import type { Context } from 'hono';

/**
 * 接続元ごとに 60 秒あたり 100 リクエスト。Workers のバインディング（wrangler.jsonc の
 * ratelimits）は期間を 10 秒か 60 秒しか取れないので、Node 版もこれに合わせている。
 * wrangler.jsonc の値と一致することは spec で確かめている。
 */
export const RATE_LIMIT = { limit: 100, windowSeconds: 60 } as const;

export interface RateLimitDecision {
  /** 通してよければ true。 */
  allowed: boolean;
  /** 次に通るまでの秒数の目安。429 の Retry-After に使う。 */
  retryAfterSeconds: number;
  /** 残り回数が分かる実装（Node）だけが返す。RateLimit-* ヘッダーになる。 */
  remaining?: number;
}

export type RateLimiter = (c: Context) => Promise<RateLimitDecision>;

/** 接続元が分からないリクエストをまとめて数えるキー。 */
export const UNKNOWN_CLIENT = 'unknown';

/**
 * 接続元アドレスをレート制限のキーにする。
 *
 * - IPv4 はそのまま
 * - IPv4-mapped IPv6（`::ffff:192.0.2.1`）は IPv4 に戻す（Node のデュアルスタックではこの形で来る）
 * - それ以外の IPv6 は先頭 64 ビットに丸める。利用者には /64 以上が割り当てられ、
 *   下位 64 ビットは自由に変えられるので、/128 で数えると上限を簡単に超えられる
 *   （RFC 6177、https://blog.cloudflare.com/introducing-ip-lists）
 * - 取れない・読めないときは UNKNOWN_CLIENT
 */
export function rateLimitKey(address: string | null | undefined): string {
  const raw = address?.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '') ?? '';
  if (raw === '') return UNKNOWN_CLIENT;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;

  const groups = expandIpv6(raw);
  if (!groups) return UNKNOWN_CLIENT;

  // ::ffff:a.b.c.d（IPv4-mapped）
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi = 0, lo = 0] = groups.slice(6);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

/** IPv6 を 16 ビット × 8 に展開する。`::` の省略と末尾の IPv4 表記に対応。読めなければ null。 */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((n) => n > 255)) return null;
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => Number.parseInt(g, 16));
}

/**
 * Node 版のキー。既定は接続元アドレス（remoteAddress）。trustedProxyHeader があればそのヘッダーを使う。
 * x-forwarded-for のような列挙は、信頼するプロキシが最後に足した右端を採る
 * （左側はクライアントが自由に書けるので、取り違えると制限を迂回できる）。
 */
export function clientKey(
  c: Context,
  trustedProxyHeader: string | null,
  remoteAddress: (c: Context) => string | undefined
): string {
  if (trustedProxyHeader) {
    const value = c.req.header(trustedProxyHeader)?.split(',').at(-1)?.trim();
    if (value) return rateLimitKey(value);
  }
  return rateLimitKey(remoteAddress(c));
}

export interface MemoryRateLimiterOptions {
  key: (c: Context) => string;
  limit?: number;
  windowSeconds?: number;
  /** テストで時刻を進めるため。既定は Date.now。 */
  now?: () => number;
  /** テストで窓の掃除を観察するため。 */
  windows?: Map<string, { count: number; resetAt: number }>;
}

/** 接続元ごとの固定ウィンドウ。単一プロセス（Node の常駐サーバー）なのでメモリで足りる。 */
export function memoryRateLimiter(options: MemoryRateLimiterOptions): RateLimiter {
  const limit = options.limit ?? RATE_LIMIT.limit;
  const windowMs = (options.windowSeconds ?? RATE_LIMIT.windowSeconds) * 1000;
  const now = options.now ?? Date.now;
  const windows = options.windows ?? new Map<string, { count: number; resetAt: number }>();

  // RateLimiter は Workers 版と同じ Promise を返す型なので、await が無くても async にしておく
  // eslint-disable-next-line @typescript-eslint/require-await -- 型を揃えるため
  return async (c) => {
    const key = options.key(c);
    const at = now();
    let window = windows.get(key);
    if (!window || window.resetAt <= at) {
      // 新しい枠を作るときに期限切れの枠を掃除する（Map が際限なく伸びないように）。
      // 枠が増えるのはこの時だけなので、ここで掃除すれば足りる。
      for (const [k, w] of windows) if (w.resetAt <= at) windows.delete(k);
      window = { count: 0, resetAt: at + windowMs };
      windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= limit,
      retryAfterSeconds: Math.ceil((window.resetAt - at) / 1000),
      remaining: Math.max(0, limit - window.count),
    };
  };
}

/** Workers の RATE_LIMITER バインディング（の必要な部分）。 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Workers 版。キーは Cloudflare が付ける cf-connecting-ip。バインディングは残り回数を
 * 返さないので、Retry-After は窓の長さを上限として返す。
 */
export function bindingRateLimiter(binding: RateLimitBinding): RateLimiter {
  return async (c) => {
    const key = rateLimitKey(c.req.header('cf-connecting-ip'));
    warnIfUnknown(key);
    const { success } = await binding.limit({ key });
    return { allowed: success, retryAfterSeconds: RATE_LIMIT.windowSeconds };
  };
}

let warnedUnknown = false;

/**
 * 接続元が分からないリクエストは1つの枠をまとめて使う（数えないと制限を素通りできるため）。
 * その枠を1人が使い切ると全員が 429 になるので、起きていることだけはログで分かるようにする。
 */
export function warnIfUnknown(key: string): void {
  if (key !== UNKNOWN_CLIENT || warnedUnknown) return;
  warnedUnknown = true;
  console.warn(
    '[rate-limit] 接続元の IP アドレスが取れないリクエストを、1つの枠でまとめて数えています。' +
      'プロキシ配下の Node 版なら TRUSTED_PROXY_HEADER を設定してください。'
  );
}
