/** ライブAPI（/api/now-playing・/badge.svg・/embed・/auth）の境界。方針は ./support.ts の冒頭を参照。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { XMLValidator } from 'fast-xml-parser';

import { collectNowPlaying } from '../core/collect.js';
import { Hono, type Context } from 'hono';
import { createApp } from '../app.js';
import { clientKey, memoryRateLimiter, rateLimitKey, RATE_LIMIT } from '../http/rateLimit.js';
import { DEMO_PAGE_CSP, HSTS, PERMISSIONS_POLICY } from '../http/securityHeaders.js';
import { openCorsWarning, parseCorsOrigins } from '../http/cors.js';
import { escapeXml } from '../render/text.js';
import {
  respondWith,
  jsonOk,
  callsTo,
  headerOf,
  aSpotifyTrack,
  givenNowPlaying,
} from './support.js';

describe('ライブAPIは公開エンドポイントとして余計なものを漏らさない', () => {
  it('キャッシュ切れの瞬間の同時アクセスは、Spotify を1回だけ叩いて結果を共有する', async () => {
    givenNowPlaying(aSpotifyTrack());

    const [a, b, c] = await Promise.all([
      collectNowPlaying(),
      collectNowPlaying(),
      collectNowPlaying(),
    ]);

    expect(callsTo('/me/player/currently-playing')).toHaveLength(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('/api/now-playing は Accept で形式が変わるので Vary: Accept を返す', async () => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp().request('/api/now-playing');

    expect(res.headers.get('vary')).toContain('Accept');
  });

  it.each([
    ['application/json, application/yaml;q=0.1', 'application/json'],
    ['application/json, application/yaml;q=0', 'application/json'],
    ['*/*', 'application/json'],
    ['application/yaml', 'application/yaml'],
    ['text/yaml', 'application/yaml'],
  ])('Accept: %s には品質値に従って %s を返す', async (accept, expected) => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp().request('/api/now-playing', { headers: { Accept: accept } });

    expect(res.headers.get('content-type')).toContain(expected);
  });

  it('?format=yaml は Accept によらず YAML を返す', async () => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp().request('/api/now-playing?format=yaml', {
      headers: { Accept: 'application/json' },
    });

    expect(res.headers.get('content-type')).toContain('application/yaml');
  });

  it('Spotify のエラー本文は応答に含めず、ステータスだけ返す', async () => {
    respondWith((url) =>
      url.includes('/me/player/currently-playing')
        ? new Response('internal detail: secret-ish', { status: 403 })
        : null
    );

    const res = await createApp().request('/api/now-playing');
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(502);
    expect(body['spotify_status']).toBe(403);
    expect(JSON.stringify(body)).not.toContain('internal detail');
  });

  it('/embed はライブ更新スクリプトだけを nonce で許す CSP を付ける', async () => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp().request('/embed');
    const csp = res.headers.get('content-security-policy') ?? '';
    const html = await res.text();

    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("default-src 'none'");
    // iframe に入るためのページなので、フレームの禁止はしない
    expect(res.headers.get('x-frame-options')).toBeNull();
  });

  it('/badge.svg は外部読み込みもスクリプトも許さない CSP を付ける', async () => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp().request('/badge.svg');

    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'"
    );
  });

  describe('Spotify 側が失敗しても、画像と iframe は壊れて見えない', () => {
    // README の <img> は JSON を描けず、iframe には生の JSON が出てしまう
    beforeEach(() => {
      respondWith((url) =>
        url.includes('/me/player/currently-playing')
          ? new Response('upstream detail: do-not-leak', { status: 503 })
          : null
      );
    });

    it('/badge.svg は「取得できませんでした」の SVG を 200 で返し、失敗はヘッダーで示す', async () => {
      const res = await createApp().request('/badge.svg');
      const svg = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/svg+xml');
      expect(res.headers.get('x-spotify-embedded-error')).toBe('spotify_unavailable');
      expect(XMLValidator.validate(svg)).toBe(true);
      expect(svg).toContain('取得できませんでした');
      expect(svg).not.toContain('do-not-leak');
    });

    it('/embed は「取得できませんでした」のカードを HTML で返す', async () => {
      const res = await createApp().request('/embed');
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('x-spotify-embedded-error')).toBe('spotify_unavailable');
      expect(html).toContain('取得できませんでした');
      expect(html).not.toContain('do-not-leak');
      // 次の周期で回復できるよう、ライブ更新のスクリプトは残す
      expect(html).toContain('/api/now-playing');
    });

    it('/api/now-playing は従来どおり JSON のエラーを返す', async () => {
      const res = await createApp().request('/api/now-playing');

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'Spotify API request failed', spotify_status: 503 });
    });
  });

  describe('/auth（ENABLE_AUTH_ROUTES=true のときだけ）', () => {
    beforeEach(() => vi.stubEnv('ENABLE_AUTH_ROUTES', 'true'));

    it('state はブラウザごとの Cookie に持ち、応答はキャッシュさせない', async () => {
      const res = await createApp().request('/auth/login');

      expect(res.status).toBe(302);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const cookie = res.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/spotify_oauth_state=[0-9a-f]{32}/);
      expect(cookie).toContain('HttpOnly');
      const state = /spotify_oauth_state=([0-9a-f]+)/.exec(cookie)![1];
      expect(res.headers.get('location')).toContain(`state=${state}`);
    });

    it('別のブラウザが始めた state では通らない', async () => {
      const app = createApp();
      const login = await app.request('/auth/login');
      const state = /spotify_oauth_state=([0-9a-f]+)/.exec(login.headers.get('set-cookie')!)![1];

      // Cookie を持たない（= 別のブラウザ）コールバック
      const res = await app.request(`/auth/callback?code=c&state=${state}`);

      expect(res.status).toBe(400);
      expect(callsTo('accounts.spotify.com/api/token')).toHaveLength(0);
    });

    /** /auth/login で発行された state と Cookie を持って、コールバックに戻ってくる。 */
    async function callback(query: (state: string) => string): Promise<Response> {
      const app = createApp();
      const login = await app.request('/auth/login');
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      const state = /spotify_oauth_state=([0-9a-f]+)/.exec(cookie)![1]!;
      return app.request(`/auth/callback?${query(state)}`, { headers: { Cookie: cookie } });
    }

    const HOSTILE_TOKEN = '<script>"x"</script>&\'';

    function givenCodeExchange(refreshToken = HOSTILE_TOKEN): void {
      respondWith((url) =>
        url.includes('accounts.spotify.com/api/token')
          ? jsonOk({ access_token: 'a', refresh_token: refreshToken, expires_in: 3600 })
          : null
      );
    }

    describe('正しい state と code で戻ってきたとき', () => {
      it('トークンエンドポイントへ認可コードを Basic 認証つきの form で送る', async () => {
        givenCodeExchange();

        await callback((state) => `code=the-code&state=${state}`);

        const call = callsTo('accounts.spotify.com/api/token')[0]!;
        expect(call.url).toBe('https://accounts.spotify.com/api/token');
        expect(call.init?.method).toBe('POST');
        expect(headerOf(call, 'Content-Type')).toBe('application/x-www-form-urlencoded');
        expect(headerOf(call, 'Authorization')).toBe(
          `Basic ${Buffer.from('spec-client-id:spec-client-secret').toString('base64')}`
        );
        const body = call.init?.body as URLSearchParams;
        expect(Object.fromEntries(body)).toEqual({
          grant_type: 'authorization_code',
          code: 'the-code',
          redirect_uri: 'http://127.0.0.1:3000/auth/callback',
        });
        // 応答しない相手を待ち続けない（Spotify API・トークン更新と同じ）
        expect(call.init?.signal).toBeInstanceOf(AbortSignal);
      });

      it('refresh_token は HTML エスケープして表示し、生の HTML としては出さない', async () => {
        givenCodeExchange();

        const res = await callback((state) => `code=c&state=${state}`);
        const html = await res.text();

        expect(res.status).toBe(200);
        expect(html).not.toContain(HOSTILE_TOKEN);
        expect(html).not.toContain('<script>"x"');
        expect(html).toContain('&lt;script&gt;&quot;x&quot;&lt;/script&gt;&amp;&apos;');
      });

      it('既定では伏せて表示し、全文は「全文を表示」の中にだけ置く', async () => {
        givenCodeExchange('AQDexampleRefreshTokenValueXYZ');

        const html = await (await callback((state) => `code=c&state=${state}`)).text();

        expect(html).toContain('SPOTIFY_REFRESH_TOKEN=AQDe…eXYZ');
        expect(html).toMatch(/<details>[\s\S]*AQDexampleRefreshTokenValueXYZ[\s\S]*<\/details>/);
        expect(html.split('AQDexampleRefreshTokenValueXYZ')).toHaveLength(2);
        expect(html).toContain('他人に見せず');
      });

      it('refresh_token をサーバーのログに出さない', async () => {
        givenCodeExchange('secret-refresh-token-value');

        await callback((state) => `code=c&state=${state}`);

        const logged = [console.log, console.warn, console.error]
          .flatMap((fn) => vi.mocked(fn).mock.calls)
          .map((args) => args.map(String).join(' '))
          .join('\n');
        expect(logged).not.toContain('secret-refresh-token-value');
      });

      it('state の Cookie を消し、応答はキャッシュさせず、コピー用のスクリプトだけを許す CSP を付ける', async () => {
        givenCodeExchange();

        const res = await callback((state) => `code=c&state=${state}`);
        const csp = res.headers.get('content-security-policy') ?? '';
        const html = await res.text();

        expect(res.headers.get('set-cookie')).toMatch(/spotify_oauth_state=;.*Max-Age=0/);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
        expect(nonce).toBeTruthy();
        expect(html).toContain(`<script nonce="${nonce}">`);
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
      });
    });

    it('承認を拒否された（error=access_denied）ら、理由を示して交換はしない', async () => {
      const res = await callback((state) => `error=access_denied&state=${state}`);

      expect(res.status).toBe(400);
      expect(await res.text()).toContain('access_denied');
      expect(callsTo('accounts.spotify.com/api/token')).toHaveLength(0);
    });

    it('state が一致しなければ、error があっても state のエラーになる', async () => {
      const res = await callback(() => 'error=access_denied&state=wrong');

      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Invalid state');
    });

    it('認可コードの交換に失敗したら、直す場所の分かる説明を 502 で返す（Spotify の本文や Secret は含めない）', async () => {
      respondWith((url) =>
        url.includes('accounts.spotify.com/api/token')
          ? new Response('{"error":"invalid_grant","error_description":"upstream-detail"}', { status: 400 })
          : null
      );

      const res = await callback((state) => `code=c&state=${state}`);
      const text = await res.text();

      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(text).toContain('Redirect URI');
      expect(text).not.toContain('upstream-detail');
      expect(text).not.toContain('spec-client-secret');
    });
  });

  it('escapeXml は XML で表せない U+FFFE/U+FFFF と孤立サロゲートを落とす', () => {
    expect(escapeXml('a\uFFFEb\uFFFFc')).toBe('abc');
    expect(escapeXml('x\uD800y\uDC00z')).toBe('xyz');
    // 対になったサロゲート（絵文字）は残す
    expect(escapeXml('🎧')).toBe('🎧');
  });
});

describe('ライブAPIの境界: 他サイトの iframe に入れてよいのは /embed だけ', () => {
  it.each(['/api/now-playing', '/badge.svg', '/health'])('%s は X-Frame-Options: DENY を返す', async (path) => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp().request(path);

    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('/embed はフレーム禁止を付けない（埋め込まれるためのページなので）', async () => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp().request('/embed');

    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('content-security-policy')).not.toContain('frame-ancestors');
  });

  /** public/_headers を「パス → ヘッダー名 → 値」に読む。 */
  function staticHeaderRules(): Map<string, Map<string, string>> {
    const source = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');
    const rules = new Map<string, Map<string, string>>();
    let current: Map<string, string> | undefined;
    for (const line of source.split('\n')) {
      if (line.startsWith('#') || line.trim() === '') continue;
      if (!line.startsWith(' ')) {
        current = new Map();
        rules.set(line.trim(), current);
        continue;
      }
      const [name, ...value] = line.trim().split(': ');
      current?.set(name!, value.join(': '));
    }
    return rules;
  }

  it('Workers の静的ファイル（Worker を通らない）にも public/_headers で同じヘッダーを付ける', () => {
    const all = staticHeaderRules().get('/*');

    expect(all?.get('X-Frame-Options')).toBe('DENY');
    expect(all?.get('X-Content-Type-Options')).toBe('nosniff');
    expect(all?.get('Referrer-Policy')).toBe('no-referrer');
    expect(all?.get('Permissions-Policy')).toBe(PERMISSIONS_POLICY);
    expect(all?.get('Strict-Transport-Security')).toBe(HSTS);
  });

  it('すべての応答に Permissions-Policy を付け、HSTS は https のときだけ付ける', async () => {
    givenNowPlaying(aSpotifyTrack());
    const app = createApp();

    const overHttp = await app.request('http://localhost/api/now-playing');
    const overHttps = await app.request('https://spotify-embedded.example/embed');

    expect(overHttp.headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
    expect(overHttp.headers.get('strict-transport-security')).toBeNull();
    expect(overHttps.headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
    expect(overHttps.headers.get('strict-transport-security')).toBe(HSTS);
  });

  describe('デモ画面（public/index.html）にも CSP を付ける', () => {
    it('Workers では public/_headers で、/ と /index.html に付ける', () => {
      const rules = staticHeaderRules();

      expect(rules.get('/')?.get('Content-Security-Policy')).toBe(DEMO_PAGE_CSP);
      expect(rules.get('/index.html')?.get('Content-Security-Policy')).toBe(DEMO_PAGE_CSP);
    });

    it('インラインのスクリプトを持たず、同一オリジンの demo.js だけを読む', () => {
      const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(html).toContain('<script src="/demo.js" defer></script>');
      expect(DEMO_PAGE_CSP).toContain("script-src 'self'");
    });
  });
});

describe('ライブAPIの境界: CORS は CORS_ORIGIN に書いたオリジンにだけ許す', () => {
  async function allowOriginFor(origin: string): Promise<string | null> {
    givenNowPlaying(aSpotifyTrack());
    const res = await createApp().request('/api/now-playing', { headers: { Origin: origin } });
    return res.headers.get('access-control-allow-origin');
  }

  it('未設定なら * を返す（ローカル開発の既定）', async () => {
    expect(await allowOriginFor('https://anywhere.example')).toBe('*');
  });

  it('1つだけ書けば、そのオリジンを返す', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://a.example');

    expect(await allowOriginFor('https://a.example')).toBe('https://a.example');
  });

  it('カンマ区切りで複数書ける（前後の空白は無視）。一覧に無いオリジンには付けない', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://a.example, https://b.example');

    expect(await allowOriginFor('https://b.example')).toBe('https://b.example');
    expect(await allowOriginFor('https://a.example')).toBe('https://a.example');
    expect(await allowOriginFor('https://evil.example')).toBeNull();
  });

  it('* のまま本番で動かすと、自分の Spotify・LLM の枠を他人のサイトに使われるので警告する', () => {
    expect(openCorsWarning(parseCorsOrigins(undefined))).toContain('CORS_ORIGIN');
    expect(openCorsWarning(parseCorsOrigins(' '))).toContain('CORS_ORIGIN');
    expect(openCorsWarning(parseCorsOrigins('https://a.example,https://b.example'))).toBeNull();
  });
});

describe('ライブAPIの境界: ランキングは出さない（静的モード専用）', () => {
  it.each(['/api/top-tracks', '/ranking.svg', '/api/recently-played'])('%s は存在せず、Spotify も叩かない', async (path) => {
    const res = await createApp().request(path);

    expect(res.status).toBe(404);
    expect(callsTo('api.spotify.com')).toHaveLength(0);
  });
});

describe('ライブAPIの境界: レート制限を超えたリクエストは、Spotify を叩かずに断る', () => {
  const denied = () => Promise.resolve({ allowed: false, retryAfterSeconds: 42 });
  const allowed = () => Promise.resolve({ allowed: true, retryAfterSeconds: 60 });

  it('/api/now-playing は JSON の 429 と Retry-After を返す', async () => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp({ rateLimiter: denied }).request('/api/now-playing');

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'Too many requests, please try again later.' });
    expect(callsTo('api.spotify.com')).toHaveLength(0);
  });

  // README の <img> は JSON を描けず、iframe には生の JSON が出てしまう（Spotify 側の失敗と同じ扱い）
  it('/badge.svg は「取得できませんでした」の SVG を返し、理由はヘッダーで示す', async () => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp({ rateLimiter: denied }).request('/badge.svg?theme=light');
    const svg = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('x-spotify-embedded-error')).toBe('rate_limited');
    expect(res.headers.get('retry-after')).toBe('42');
    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain('取得できませんでした');
    expect(callsTo('api.spotify.com')).toHaveLength(0);
  });

  it('/embed は「取得できませんでした」の HTML を返し、ライブ更新で回復できるようにする', async () => {
    givenNowPlaying(aSpotifyTrack());

    const res = await createApp({ rateLimiter: denied }).request('/embed');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-spotify-embedded-error')).toBe('rate_limited');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'nonce-");
    expect(html).toContain('取得できませんでした');
    expect(html).toContain('/api/now-playing');
    expect(callsTo('api.spotify.com')).toHaveLength(0);
  });

  it('/health は数えない（利用者と同じ枠を共有していても、死活監視が 429 で落ちないように）', async () => {
    let counted = 0;
    const app = createApp({
      rateLimiter: () => {
        counted += 1;
        return denied();
      },
    });

    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(counted).toBe(0);
  });

  it('制限内なら通常どおり応答する', async () => {
    givenNowPlaying(aSpotifyTrack());
    const app = createApp({ rateLimiter: allowed });

    const res = await app.request('/api/now-playing');

    expect(res.status).toBe(200);
  });

  it('残り回数が分かる実装（Node）なら RateLimit-* ヘッダーを付ける', async () => {
    givenNowPlaying(aSpotifyTrack());
    const app = createApp({
      rateLimiter: () => Promise.resolve({ allowed: true, retryAfterSeconds: 30, remaining: 7 }),
    });

    const res = await app.request('/api/now-playing');

    expect(res.headers.get('ratelimit-limit')).toBe('100');
    expect(res.headers.get('ratelimit-remaining')).toBe('7');
    expect(res.headers.get('ratelimit-reset')).toBe('30');
  });
});

describe('ライブAPIのレート制限の数え方（Node 版のメモリ実装）', () => {
  function request(headers: Record<string, string> = {}): Context {
    const app = new Hono();
    let captured: Context | undefined;
    app.get('/', (c) => {
      captured = c;
      return c.text('ok');
    });
    void app.request('/', { headers });
    return captured!;
  }

  it('接続元ごとに上限まで通し、超えたら拒否する。窓が切れたら数え直す', async () => {
    let now = 0;
    const limiter = memoryRateLimiter({ key: () => '192.0.2.1', limit: 3, windowSeconds: 60, now: () => now });
    const c = request();

    const first = await Promise.all([limiter(c), limiter(c), limiter(c)]);
    const fourth = await limiter(c);
    now = 60_000;
    const afterWindow = await limiter(c);

    expect(first.map((d) => d.allowed)).toEqual([true, true, true]);
    expect(first.map((d) => d.remaining)).toEqual([2, 1, 0]);
    expect(fourth).toEqual({ allowed: false, retryAfterSeconds: 60, remaining: 0 });
    expect(afterWindow.allowed).toBe(true);
  });

  it('既定の上限は Workers（wrangler.jsonc）と同じ 60 秒あたり 100 回', async () => {
    const limiter = memoryRateLimiter({ key: () => 'k', now: () => 0 });
    const c = request();

    const decisions = [];
    for (let i = 0; i < 101; i += 1) decisions.push(await limiter(c));

    expect(decisions.filter((d) => d.allowed)).toHaveLength(100);
    expect(decisions.at(-1)?.allowed).toBe(false);

    // wrangler.jsonc の ratelimits と食い違わないこと（コメントを除いて読む）
    const wrangler = JSON.parse(
      readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    ) as { ratelimits: { simple: { limit: number; period: number } }[] };
    expect(wrangler.ratelimits[0]!.simple).toEqual({
      limit: RATE_LIMIT.limit,
      period: RATE_LIMIT.windowSeconds,
    });
  });

  it('期限切れの窓は掃除し、Map が伸び続けない', async () => {
    let now = 0;
    let key = 'a';
    const windows = new Map<string, { count: number; resetAt: number }>();
    const limiter = memoryRateLimiter({ key: () => key, now: () => now, windows });
    const c = request();

    await limiter(c);
    key = 'b';
    await limiter(c);
    now = 61_000;
    key = 'c';
    await limiter(c);

    expect([...windows.keys()]).toEqual(['c']);
  });

  describe('キーの決め方（clientKey）', () => {
    const remote = () => '198.51.100.9';

    it('TRUSTED_PROXY_HEADER の列挙は右端（信頼するプロキシが足した値）を採る', () => {
      const c = request({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' });

      expect(clientKey(c, 'x-forwarded-for', remote)).toBe('2.2.2.2');
    });

    it('TRUSTED_PROXY_HEADER が未設定なら、x-forwarded-for は無視して接続元を使う', () => {
      const c = request({ 'x-forwarded-for': '1.1.1.1' });

      expect(clientKey(c, null, remote)).toBe('198.51.100.9');
    });
  });

  describe('IPv6 は /64 に丸める（下位 64 ビットは利用者が自由に変えられるため）', () => {
    it.each([
      ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
      ['2001:db8:1:2:ffff::9', '2001:db8:1:2::/64'],
      ['2001:0db8:0001:0002:0000:0000:0000:0001', '2001:db8:1:2::/64'],
      ['2001:db8:1:3::1', '2001:db8:1:3::/64'],
      ['::ffff:192.0.2.1', '192.0.2.1'],
      ['192.0.2.1', '192.0.2.1'],
      ['[2001:db8:1:2::1]', '2001:db8:1:2::/64'],
      ['fe80::1%eth0', 'fe80:0:0:0::/64'],
      ['', 'unknown'],
      [undefined, 'unknown'],
      ['not-an-ip', 'unknown'],
    ])('%s → %s', (address, key) => {
      expect(rateLimitKey(address)).toBe(key);
    });

    it('同じ /64 の別アドレスは同じキー、別の /64 は別のキーになる', () => {
      expect(rateLimitKey('2001:db8:1:2::1')).toBe(rateLimitKey('2001:db8:1:2:ffff::9'));
      expect(rateLimitKey('2001:db8:1:3::1')).not.toBe(rateLimitKey('2001:db8:1:2::1'));
    });
  });
});
