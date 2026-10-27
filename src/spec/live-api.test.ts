/** ライブAPI（/api/now-playing・/badge.svg・/embed・/auth）の境界。方針は ./support.ts の冒頭を参照。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { XMLValidator } from 'fast-xml-parser';

import { collectNowPlaying } from '../core/collect.js';
import { createApp } from '../app.js';
import { escapeXml } from '../render/text.js';
import { renderEmbedPage } from '../render/page.js';
import type { NowPlayingResponse } from '../types/index.js';
import {
  NOW_ISO,
  ART_640,
  respondWith,
  callsTo,
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

  it('/embed のライブ更新は、タブが非表示の間は API を叩かず、表示に戻ったらすぐ取り直す', async () => {
    givenNowPlaying(aSpotifyTrack());
    const html = await (await createApp().request('/embed')).text();
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]!;

    // ブラウザの代わりに、スクリプトが触るものだけを用意して実行する
    let hidden = true;
    let onInterval: (() => void) | undefined;
    let onVisibilityChange: (() => void) | undefined;
    const fetched: string[] = [];
    runInNewContext(script, {
      document: {
        get hidden() {
          return hidden;
        },
        addEventListener: (type: string, fn: () => void) => {
          if (type === 'visibilitychange') onVisibilityChange = fn;
        },
        getElementById: () => null,
      },
      setInterval: (fn: () => void) => {
        onInterval = fn;
        return 1;
      },
      fetch: (url: string) => {
        fetched.push(url);
        return new Promise(() => {});
      },
      location: { reload: () => {} },
    });

    onInterval!();
    expect(fetched).toEqual([]);

    hidden = false;
    onVisibilityChange!();
    expect(fetched).toEqual(['/api/now-playing']);

    onInterval!();
    expect(fetched).toHaveLength(2);
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
  });

  it('escapeXml は XML で表せない U+FFFE/U+FFFF と孤立サロゲートを落とす', () => {
    expect(escapeXml('a\uFFFEb\uFFFFc')).toBe('abc');
    expect(escapeXml('x\uD800y\uDC00z')).toBe('xyz');
    // 対になったサロゲート（絵文字）は残す
    expect(escapeXml('🎧')).toBe('🎧');
  });
});

describe('/embed のライブ更新は、表示を取得した内容と食い違わせない', () => {
  function aNowPlaying(name: string, moodText: string | null): NowPlayingResponse {
    return {
      is_playing: true,
      track: {
        id: name,
        name,
        artist: 'Neon District',
        album: 'After Hours',
        album_art_url: ART_640,
        duration_ms: 213_000,
        popularity: null,
        spotify_url: `https://open.spotify.com/track/${name}`,
        preview_url: null,
      },
      mood: moodText ? { text: moodText, generated_at: NOW_ISO } : null,
      fetched_at: NOW_ISO,
    };
  }

  /**
   * 初期表示 `initial` で描いたページのスクリプトを、ブラウザの代わりに最小限の DOM で動かし、
   * 定期取得で `next` が返ってきたあとの状態を返す。
   */
  async function liveUpdate(initial: NowPlayingResponse, next: NowPlayingResponse) {
    const html = renderEmbedPage({
      nowPlaying: initial,
      state: 'playing',
      liveEndpoint: '/api/now-playing',
    });
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]!;

    const elements: Record<string, { tagName: string; textContent: string; attrs: Record<string, string> }> =
      {};
    for (const id of ['card', 'label', 'label-text', 'mood', 'track', 'artist', 'art']) {
      elements[id] = { tagName: id === 'card' ? 'A' : id === 'art' ? 'IMG' : 'P', textContent: '', attrs: {} };
    }
    if (initial.mood?.text) elements['mood']!.textContent = initial.mood.text;
    else delete elements['mood'];

    let onInterval: (() => void) | undefined;
    let reloaded = false;
    const document = {
      hidden: false,
      title: '',
      addEventListener: () => {},
      getElementById: (id: string) => {
        const el = elements[id];
        if (!el) return null;
        return {
          ...el,
          get textContent() {
            return el.textContent;
          },
          set textContent(value: string) {
            el.textContent = value;
          },
          setAttribute: (name: string, value: string) => {
            el.attrs[name] = value;
          },
          removeAttribute: (name: string) => {
            delete el.attrs[name];
          },
        };
      },
    };
    runInNewContext(script, {
      document,
      setInterval: (fn: () => void) => {
        onInterval = fn;
        return 1;
      },
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(next) }),
      location: {
        reload: () => {
          reloaded = true;
        },
      },
    });

    onInterval!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { reloaded, elements, title: document.title };
  }

  it('次の曲にムード文が無ければ、前の曲のムード文を残さない（読み込み直す）', async () => {
    const result = await liveUpdate(aNowPlaying('A', 'A のムード'), aNowPlaying('B', null));

    expect(result.reloaded).toBe(true);
  });

  it('最初はムード文が無く、後からムード文が返ってきたら表示する（読み込み直す）', async () => {
    const result = await liveUpdate(aNowPlaying('A', null), aNowPlaying('A', 'あとから来たムード'));

    expect(result.reloaded).toBe(true);
  });

  it('ムード文がある曲どうしなら、読み込み直さずに曲名・ムード文・aria-label・タイトルを差し替える', async () => {
    const result = await liveUpdate(aNowPlaying('A', 'A のムード'), aNowPlaying('B', 'B のムード'));

    expect(result.reloaded).toBe(false);
    expect(result.elements['track']!.textContent).toBe('B');
    expect(result.elements['mood']!.textContent).toBe('B のムード');
    expect(result.elements['card']!.attrs['aria-label']).toBe(
      '再生中: B のムード — B / Neon District（Spotifyで開く）'
    );
    expect(result.title).toBe('Now Playing: B / Neon District');
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

  it('Workers の静的ファイル（Worker を通らない）にも public/_headers で同じヘッダーを付ける', () => {
    const source = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');
    const lines = source.split('\n').filter((line) => !line.startsWith('#'));
    const rule = lines.slice(lines.indexOf('/*') + 1).map((line) => line.trim());

    expect(lines).toContain('/*');
    expect(rule).toContain('X-Frame-Options: DENY');
    expect(rule).toContain('X-Content-Type-Options: nosniff');
    expect(rule).toContain('Referrer-Policy: no-referrer');
  });
});

describe('ライブAPIの境界: ランキングは出さない（静的モード専用）', () => {
  it.each(['/api/top-tracks', '/ranking.svg', '/api/recently-played'])('%s は存在せず、Spotify も叩かない', async (path) => {
    const res = await createApp().request(path);

    expect(res.status).toBe(404);
    expect(callsTo('api.spotify.com')).toHaveLength(0);
  });
});

describe('ライブAPIの境界: レート制限を超えたリクエストは、Spotify を叩かずに 429 を返す', () => {
  it.each(['/api/now-playing', '/badge.svg', '/embed'])('%s', async (path) => {
    givenNowPlaying(aSpotifyTrack());
    const app = createApp({ rateLimiter: () => Promise.resolve(false) });

    const res = await app.request(path);

    expect(res.status).toBe(429);
    expect(callsTo('api.spotify.com')).toHaveLength(0);
  });

  it('/health は数えない（利用者と同じ枠を共有していても、死活監視が 429 で落ちないように）', async () => {
    let counted = 0;
    const app = createApp({
      rateLimiter: () => {
        counted += 1;
        return Promise.resolve(false);
      },
    });

    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(counted).toBe(0);
  });

  it('制限内なら通常どおり応答する', async () => {
    givenNowPlaying(aSpotifyTrack());
    const app = createApp({ rateLimiter: () => Promise.resolve(true) });

    const res = await app.request('/api/now-playing');

    expect(res.status).toBe(200);
  });
});
