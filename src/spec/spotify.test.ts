/** Spotify から取得する（要件1・2）と、その土台の spotifyFetch の契約。方針は ./support.ts の冒頭を参照。 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { XMLValidator } from 'fast-xml-parser';

import { loadStoredAuth } from '../authStore.js';
import { nowPlayingCache } from '../cache/index.js';
import { artistGenresAvailable } from '../spotify/artists.js';
import { getAccessToken } from '../spotify/auth.js';
import { collectNowPlaying, collectRecentlyPlayed, collectTopTracks } from '../core/collect.js';
import { isTopTracksLimit, isTopTracksRange } from '../core/topTracksParams.js';
import { generate } from '../cli/generate.js';
import { createApp } from '../app.js';
import { renderNowPlayingCard } from '../render/card.js';
import { SpotifyApiError, SpotifyAuthError, spotifyFetch } from '../spotify/client.js';
import { TOP_TRACKS_RANGES, type TopTracksRange } from '../types/index.js';
import {
  NOW,
  NOW_ISO,
  ART_640,
  ART_300,
  TRACK_SUMMARY_KEYS,
  TOP_TRACK_ENTRY_KEYS,
  respondWith,
  jsonOk,
  callsTo,
  headerOf,
  installDefaultHandlers,
  clearHandlers,
  aSpotifyTrack,
  aLocalFileTrack,
  givenNowPlaying,
  givenRecentlyPlayedItems,
  givenTopTracks,
  givenArtistGenres,
  givenLlmConfigured,
  givenLlmReplies,
} from './support.js';

describe('要件1: Spotify API を叩いて、直近3種類のランキングを取得できる', () => {
  it.each(TOP_TRACKS_RANGES)(
    '%s を指定すると、その time_range で /me/top/tracks を叩き、応答にも反映される',
    async (range: TopTracksRange) => {
      givenTopTracks([aSpotifyTrack()]);

      const result = await collectTopTracks({ range });

      const call = callsTo('/me/top/tracks')[0]!;
      expect(call).toBeDefined();
      expect(call.url).toContain(`time_range=${range}`);
      expect(headerOf(call, 'Authorization')).toMatch(/^Bearer .+/);
      expect(result.range).toBe(range);
      expect(result.fetched_at).toBe(NOW_ISO);
    }
  );

  it('3種類すべてを同じプロセスで取得でき、取り違えない', async () => {
    // 期間ごとに別の曲を返すようにして、取り違えが起きたら分かるようにする
    respondWith((url) => {
      if (!url.includes('/me/top/tracks')) return null;
      const range = /time_range=([a-z_]+)/.exec(url)?.[1] ?? 'unknown';
      return jsonOk({ items: [aSpotifyTrack({ id: range, name: range })] });
    });

    for (const range of TOP_TRACKS_RANGES) {
      const result = await collectTopTracks({ range });
      expect(result.tracks[0]!.name).toBe(range);
    }
    expect(callsTo('/me/top/tracks')).toHaveLength(3);
  });

  it('取得件数として指定できるのは 10 / 30 / 50 のみ', () => {
    // Spotify 側は 1〜50 の任意値を許すが、選択肢を3段階に固定している
    // （意図的な制約であって未実装ではない）。CLI はそれ以外をエラーにする。
    expect([10, 30, 50].every(isTopTracksLimit)).toBe(true);
    expect(isTopTracksLimit(20)).toBe(false);
    expect(isTopTracksLimit('10')).toBe(false);
  });

  it('期間は Spotify の3種類のみ', () => {
    expect(TOP_TRACKS_RANGES.every(isTopTracksRange)).toBe(true);
    expect(isTopTracksRange('6months')).toBe(false);
    expect(isTopTracksRange('MEDIUM_TERM')).toBe(false);
  });

  it('取得件数はクエリに載り、レスポンスにもそのまま残る', async () => {
    givenTopTracks([aSpotifyTrack()]);

    const result = await collectTopTracks({ range: 'long_term', limit: 10 });

    expect(callsTo('/me/top/tracks')[0]!.url).toContain('limit=10');
    expect(result.limit).toBe(10);
  });

  it('ランキングの各要素は rank 付きで、約束したキーをすべて持つ', async () => {
    givenTopTracks([aSpotifyTrack(), aSpotifyTrack({ id: 'track-2', name: 'Second' })]);

    const result = await collectTopTracks();

    expect(result.tracks.map((t) => t.rank)).toEqual([1, 2]);
    expect(Object.keys(result.tracks[0]!).sort()).toEqual(TOP_TRACK_ENTRY_KEYS);
  });
});

describe('要件2: Spotify API を叩いて、今再生している曲を表示できる', () => {
  it('再生中なら曲情報を返す', async () => {
    givenNowPlaying(aSpotifyTrack());

    const result = await collectNowPlaying();

    expect(callsTo('/me/player/currently-playing')).toHaveLength(1);
    expect(result.is_playing).toBe(true);
    expect(result.track?.name).toBe('Midnight Drive');
    expect(result.track?.artist).toBe('Neon District');
    expect(result.fetched_at).toBe(NOW_ISO);
    expect(Object.keys(result)).toEqual(['is_playing', 'track', 'mood', 'fetched_at']);
    expect(Object.keys(result.track!).sort()).toEqual(TRACK_SUMMARY_KEYS);
  });

  it('停止中・デバイスなし（204）なら、再生していないことを返す', async () => {
    givenNowPlaying(null);

    const result = await collectNowPlaying();

    expect(result.is_playing).toBe(false);
    expect(result.track).toBeNull();
    expect(result.mood).toBeNull();
  });

  it('一時停止中（is_playing: false）も再生していない扱いにする', async () => {
    respondWith((url) =>
      url.includes('/me/player/currently-playing')
        ? jsonOk({ is_playing: false, progress_ms: 0, item: aSpotifyTrack(), timestamp: 0 })
        : null
    );

    const result = await collectNowPlaying();

    expect(result.is_playing).toBe(false);
    expect(result.track).toBeNull();
  });

  describe('ローカルファイル（Spotify のカタログに無い曲）', () => {
    // id も spotify_url も無く公開スキーマを満たせないので、再生していない扱いにする。
    it('再生していないことを返し、ジャンルも LLM も呼ばない', async () => {
      givenLlmConfigured();
      givenLlmReplies('今チルな気分になっています');
      givenNowPlaying(aLocalFileTrack());

      const result = await collectNowPlaying();

      expect(result).toMatchObject({ is_playing: false, track: null, mood: null });
      expect(callsTo('/artists')).toHaveLength(0);
      expect(callsTo('/chat/completions')).toHaveLength(0);
    });

    it('/embed と /badge.svg は壊れずに描画できる', async () => {
      givenNowPlaying(aLocalFileTrack());
      const app = createApp();

      const embed = await app.request('/embed');
      nowPlayingCache.flushAll();
      const badge = await app.request('/badge.svg');

      expect(embed.status).toBe(200);
      expect(await embed.text()).toContain('再生していません');
      expect(badge.status).toBe(200);
      expect(XMLValidator.validate(await badge.text())).toBe(true);
    });

    it('静的モードでは前回の曲を引き継いで生成を続ける', async () => {
      const outDir = mkdtempSync(join(tmpdir(), 'spotify-embedded-spec-local-'));
      try {
        const run = () =>
          generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: true });
        givenNowPlaying(aSpotifyTrack());
        givenTopTracks([aSpotifyTrack()]);
        await run();

        clearHandlers();
        installDefaultHandlers();
        givenNowPlaying(aLocalFileTrack());
        givenTopTracks([aSpotifyTrack()]);
        await run();

        const snapshot = JSON.parse(readFileSync(join(outDir, 'snapshot.json'), 'utf8')) as {
          state: string;
          track: { name: string };
        };
        expect(snapshot.state).toBe('recent');
        expect(snapshot.track.name).toBe('Midnight Drive');
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    });

    it('再生履歴の先頭がローカルファイルなら、その前に聴いたカタログの曲を採る', async () => {
      const earlier = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
      givenNowPlaying(null);
      givenRecentlyPlayedItems([
        { track: aLocalFileTrack(), playedAt: NOW_ISO },
        { track: aSpotifyTrack({ id: 'catalog', name: 'Catalog Song' }), playedAt: earlier },
      ]);

      const recent = await collectRecentlyPlayed({ previous: null });

      expect(callsTo('/me/player/recently-played')[0]!.url).toContain('limit=10');
      expect(recent?.track.name).toBe('Catalog Song');
      expect(recent?.played_at).toBe(earlier);
    });

    it('取得した範囲がすべてローカルファイルなら採らない', async () => {
      givenNowPlaying(null);
      givenRecentlyPlayedItems([
        { track: aLocalFileTrack(), playedAt: NOW_ISO },
        { track: aLocalFileTrack(), playedAt: NOW_ISO },
      ]);

      const recent = await collectRecentlyPlayed({ previous: null });

      expect(recent).toBeNull();
    });

    it('再生履歴の先頭がカタログの曲なら、その曲を採る', async () => {
      givenNowPlaying(null);
      givenRecentlyPlayedItems([
        { track: aSpotifyTrack(), playedAt: NOW_ISO },
        { track: aSpotifyTrack({ id: 'older', name: 'Older' }), playedAt: NOW_ISO },
      ]);

      const recent = await collectRecentlyPlayed({ previous: null });

      expect(recent?.track.id).toBe('track-1');
      expect(recent?.played_at).toBe(NOW_ISO);
    });
  });

  it('複数アーティストはカンマ区切りにまとめる', async () => {
    givenNowPlaying(
      aSpotifyTrack({
        artists: [
          { id: 'a1', name: 'Alpha', external_urls: { spotify: 'https://example.test/a1' } },
          { id: 'a2', name: 'Beta', external_urls: { spotify: 'https://example.test/a2' } },
        ],
      })
    );

    const result = await collectNowPlaying();

    expect(result.track?.artist).toBe('Alpha, Beta');
  });

  it('ジャケ写は300px以上の最大サイズを選ぶ', async () => {
    givenNowPlaying(aSpotifyTrack());

    const result = await collectNowPlaying();

    expect(result.track?.album_art_url).toBe(ART_640);
  });

  describe('Spotify が返さなくなったフィールドの扱い', () => {
    it('popularity / preview_url が欠けていても、キーは null として必ず存在する', async () => {
      // 2024年11月以降に作成されたアプリの既定の形。利用側に分岐を
      // 増やさないため、キーを落とさず null を入れる契約になっている。
      givenNowPlaying(aSpotifyTrack());

      const result = await collectNowPlaying();

      expect(result.track).toHaveProperty('popularity', null);
      expect(result.track).toHaveProperty('preview_url', null);
    });

    it('/artists が 403 でもジャンル無しで続行し、曲情報は返る', async () => {
      givenTopTracks([aSpotifyTrack()]);

      const result = await collectTopTracks();

      expect(callsTo('/artists?ids=')).toHaveLength(1);
      expect(result.tracks[0]!.genres).toEqual([]);
      expect(result.tracks[0]!.name).toBe('Midnight Drive');
    });

    it.each([
      ['503', () => new Response('unavailable', { status: 503 })],
      [
        'タイムアウト',
        (): Response => {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        },
      ],
    ])('/artists が一時的に失敗（%s）しても、次の呼び出しでは再び /artists を呼ぶ', async (_, fail) => {
      givenTopTracks([aSpotifyTrack()]);
      respondWith((url) => (url.includes('/artists?ids=') ? fail() : null));

      const first = await collectTopTracks();
      expect(first.tracks[0]!.name).toBe('Midnight Drive');
      expect(artistGenresAvailable()).toBe(true);

      givenArtistGenres({ 'artist-1': ['city pop'] });
      const second = await collectTopTracks();

      expect(callsTo('/artists?ids=')).toHaveLength(2);
      expect(second.tracks[0]!.genres).toEqual(['city pop']);
    });

    it('/artists が 403 なら、以降そのプロセスでは呼ばない', async () => {
      givenTopTracks([aSpotifyTrack()]);

      await collectTopTracks();
      await collectTopTracks();

      expect(callsTo('/artists?ids=')).toHaveLength(1);
      expect(artistGenresAvailable()).toBe(false);
    });

    it('ジャンルが返る環境（extended quota mode）ではそのまま載る', async () => {
      givenTopTracks([aSpotifyTrack()]);
      givenArtistGenres({ 'artist-1': ['city pop', 'synthwave'] });

      const result = await collectTopTracks();

      expect(result.tracks[0]!.genres).toEqual(['city pop', 'synthwave']);
    });
  });

  it('取得した曲をSVGカードとして描画できる', () => {
    const svg = renderNowPlayingCard({
      state: 'playing',
      track: {
        id: 'track-1',
        name: 'Midnight Drive',
        artist: 'Neon District',
        album: 'After Hours',
        album_art_url: ART_300,
        duration_ms: 213_000,
        popularity: null,
        spotify_url: 'https://open.spotify.com/track/track-1',
        preview_url: null,
      },
      mood: { text: '今チルな気分になっています', generated_at: NOW_ISO },
      theme: 'dark',
    });

    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain('Midnight Drive');
    expect(svg).toContain('今チルな気分になっています');
  });

  it('何も分からないとき（idle）も、壊れたカードにはしない', () => {
    const svg = renderNowPlayingCard({ state: 'idle', track: null, mood: null });

    expect(XMLValidator.validate(svg)).toBe(true);
  });
});

describe('spotifyFetch の契約（要件1・2の土台）', () => {
  it('401 ならトークンを取り直して一度だけ再試行する', async () => {
    let issued = 0;
    respondWith((url) => {
      if (!url.includes('accounts.spotify.com/api/token')) return null;
      issued += 1;
      return jsonOk({ access_token: `refreshed-token-${issued}`, expires_in: 3600 });
    });

    let attempt = 0;
    respondWith((url) => {
      if (!url.includes('/me/top/tracks')) return null;
      attempt += 1;
      return attempt === 1 ? new Response('expired', { status: 401 }) : jsonOk({ items: [] });
    });

    const res = await spotifyFetch('/me/top/tracks');

    expect(res).not.toBeNull();
    expect(attempt).toBe(2);
    // 再試行は取り直した新しいトークンで行う
    const retry = callsTo('/me/top/tracks')[1]!;
    expect(headerOf(retry, 'Authorization')).toBe(`Bearer refreshed-token-${issued}`);
  });

  it('取り直しても 401 なら SpotifyAuthError', async () => {
    respondWith((url) =>
      url.includes('/me/top/tracks') ? new Response('expired', { status: 401 }) : null
    );

    await expect(spotifyFetch('/me/top/tracks')).rejects.toBeInstanceOf(SpotifyAuthError);
    expect(callsTo('/me/top/tracks')).toHaveLength(2);
  });

  describe('応答しない相手を待ち続けない（タイムアウト）', () => {
    /** AbortSignal.timeout() が時間切れになったときに fetch が投げるもの */
    function timedOut(): never {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }

    it('Spotify API とトークン更新の fetch には AbortSignal を付ける', async () => {
      let attempt = 0;
      respondWith((url) => {
        if (!url.includes('/me/top/tracks')) return null;
        attempt += 1;
        // 1回目は 401 にしてトークン更新を起こす
        return attempt === 1 ? new Response('expired', { status: 401 }) : jsonOk({ items: [] });
      });

      await spotifyFetch('/me/top/tracks');

      expect(callsTo('/me/top/tracks').every((call) => call.init?.signal instanceof AbortSignal)).toBe(
        true
      );
      expect(callsTo('accounts.spotify.com/api/token').at(-1)?.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('Spotify API が時間内に応答しなければ、ライブAPIは 504 を返す', async () => {
      respondWith((url) => (url.includes('/me/player/currently-playing') ? timedOut() : null));

      await expect(spotifyFetch('/me/player/currently-playing')).rejects.toMatchObject({
        name: 'SpotifyTimeoutError',
      });
      const res = await createApp().request('/api/now-playing');
      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({ error: 'Spotify API timed out' });
    });

    it('ジャケ写の取得が時間内に終わらなければ、プレースホルダのカードを返す', async () => {
      givenNowPlaying(aSpotifyTrack());
      respondWith((url) => (url.includes('.scdn.co') ? timedOut() : null));

      const res = await createApp().request('/badge.svg');
      const svg = await res.text();

      expect(res.status).toBe(200);
      expect(XMLValidator.validate(svg)).toBe(true);
      expect(svg).not.toContain('data:image/jpeg');
      expect(callsTo('.scdn.co')[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('トークン更新の失敗', () => {
    // トークンはモジュール内にキャッシュされるので、API の 401 で取り直しを起こす
    function givenTokenEndpointFails(status: number, body: string): void {
      respondWith((url) =>
        url.includes('/me/player/currently-playing') ? new Response('expired', { status: 401 }) : null
      );
      respondWith((url) =>
        url.includes('accounts.spotify.com/api/token')
          ? new Response(body, { status, headers: { 'content-type': 'application/json' } })
          : null
      );
    }

    it('refresh_token が失効（400 invalid_grant）なら、502 と再セットアップの案内を返す', async () => {
      givenTokenEndpointFails(400, '{"error":"invalid_grant","error_description":"Refresh token revoked"}');

      const res = await createApp().request('/api/now-playing');

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: 'Spotify authentication failed. Re-run `npm run setup` to get a new refresh_token.',
      });
    });

    it('Client ID / Secret の誤り（401 invalid_client）も認証エラーとして扱い、原因を区別できる', async () => {
      givenTokenEndpointFails(401, '{"error":"invalid_client","error_description":"Invalid client"}');

      await expect(spotifyFetch('/me/player/currently-playing')).rejects.toMatchObject({
        name: 'SpotifyAuthError',
        reason: 'invalid_client',
      });
    });

    it('5xx は設定の問題ではないので、認証エラーにしない', async () => {
      givenTokenEndpointFails(503, 'Service Unavailable');

      const err = await spotifyFetch('/me/player/currently-playing').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SpotifyAuthError);
    });
  });

  it('204（本文なし）は null を返す', async () => {
    respondWith((url) =>
      url.includes('/me/player/currently-playing') ? new Response(null, { status: 204 }) : null
    );

    await expect(spotifyFetch('/me/player/currently-playing')).resolves.toBeNull();
  });

  describe('429 は Retry-After 付きの SpotifyRateLimitError', () => {
    function givenRateLimited(retryAfter: string | null): void {
      respondWith((url) =>
        url.includes('/me/top/tracks') || url.includes('/me/player/currently-playing')
          ? new Response('slow down', {
              status: 429,
              headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
            })
          : null
      );
    }

    it.each([
      ['7', 7],
      ['30', 30],
      // HTTP-date（RFC 9110 §10.2.3）は現在時刻との差を秒にする
      [new Date(NOW.getTime() + 30 * 1000).toUTCString(), 30],
      [new Date(NOW.getTime() - 30 * 1000).toUTCString(), 0],
      ['abc', 1],
      ['', 1],
      [null, 1],
    ])('Retry-After: %j → %d 秒', async (header, expected) => {
      givenRateLimited(header);

      await expect(spotifyFetch('/me/top/tracks')).rejects.toMatchObject({
        name: 'SpotifyRateLimitError',
        retryAfter: expected,
      });
    });

    it('秒数として読めなくても、ライブAPIの Retry-After と retry_after は数値になる', async () => {
      givenRateLimited('Wed, 21 Oct 2015 07:28:00 GMT');

      const res = await createApp().request('/api/now-playing');

      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('0');
      expect(await res.json()).toEqual({ error: 'Spotify rate limit exceeded', retry_after: 0 });
    });
  });

  it('401 で取り直す前に、使わない1本目の応答の本文を捨てる（Node で接続を解放するため）', async () => {
    const cancel = vi.fn(() => Promise.resolve());
    let attempt = 0;
    respondWith((url) => {
      if (!url.includes('/me/top/tracks')) return null;
      attempt += 1;
      if (attempt > 1) return jsonOk({ items: [] });
      const expired = new Response('expired', { status: 401 });
      Object.defineProperty(expired.body, 'cancel', { value: cancel });
      return expired;
    });

    await spotifyFetch('/me/top/tracks');

    expect(attempt).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('その他の非2xx は SpotifyApiError として投げる', async () => {
    // ここで弾かないと、呼び出し側が data.items を undefined として扱い、
    // 原因の分からない TypeError になる。
    respondWith((url) =>
      url.includes('/me/top/tracks') ? new Response('boom', { status: 500 }) : null
    );

    await expect(spotifyFetch('/me/top/tracks')).rejects.toBeInstanceOf(SpotifyApiError);
  });

  it('403 は「2024年11月以降のアプリでは制限される」ことまで説明する', async () => {
    respondWith((url) =>
      url.includes('/artists') ? new Response('forbidden', { status: 403 }) : null
    );

    await expect(spotifyFetch('/artists?ids=a')).rejects.toThrow(/2024年11月/);
  });
});

describe('アクセストークンの更新', () => {
  function tokenRequests() {
    return callsTo('accounts.spotify.com/api/token');
  }

  function refreshTokenSent(index: number): string | null {
    const body = tokenRequests()[index]?.init?.body;
    return body instanceof URLSearchParams ? body.get('refresh_token') : null;
  }

  it('トークンが無い状態で同時に呼ばれても、更新のリクエストは1回だけ', async () => {
    const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);

    expect(tokenRequests()).toHaveLength(1);
    expect(new Set(tokens)).toEqual(new Set(['spec-access-token']));
  });

  it('generate の1回の実行で、トークン更新は1回しか送られない', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'spotify-embedded-spec-token-'));
    try {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: true });

      expect(tokenRequests()).toHaveLength(1);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('更新が失敗したら待っていた呼び出しすべてに同じエラーが返り、次の呼び出しで改めて更新する', async () => {
    let fail = true;
    respondWith((url) => {
      if (!url.includes('accounts.spotify.com/api/token')) return null;
      return fail
        ? new Response('{"error":"invalid_grant"}', { status: 400 })
        : jsonOk({ access_token: 'second-try', expires_in: 3600 });
    });

    const results = await Promise.allSettled([getAccessToken(), getAccessToken()]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(results.map((r) => (r as PromiseRejectedResult).reason as unknown)).toEqual([
      expect.any(SpotifyAuthError),
      expect.any(SpotifyAuthError),
    ]);
    expect(tokenRequests()).toHaveLength(1);

    fail = false;
    await expect(getAccessToken()).resolves.toBe('second-try');
    expect(tokenRequests()).toHaveLength(2);
  });

  describe('Spotify が新しい refresh_token を返したら（ローテーション）', () => {
    function givenRotation(): void {
      respondWith((url) =>
        url.includes('accounts.spotify.com/api/token')
          ? jsonOk({ access_token: 'rotated-access', expires_in: 3600, refresh_token: 'rotated-refresh' })
          : null
      );
    }

    it('このプロセスでは以降、新しい refresh_token で更新する', async () => {
      givenRotation();

      await getAccessToken();
      await getAccessToken(true);

      expect(refreshTokenSent(0)).toBe('spec-refresh-token');
      expect(refreshTokenSent(1)).toBe('rotated-refresh');
    });

    it('環境変数で設定しているなら、登録値の更新が必要だと警告する（値はログに出さない）', async () => {
      givenRotation();

      await getAccessToken();

      const warned = vi.mocked(console.warn).mock.calls.map((args) => args.join(' ')).join('\n');
      expect(warned).toContain('SPOTIFY_REFRESH_TOKEN');
      expect(warned).not.toContain('rotated-refresh');
    });

    it('data/auth.json から読んでいるなら、そこへ書き戻す', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'spotify-embedded-spec-rotate-'));
      try {
        const storePath = join(dir, 'auth.json');
        writeFileSync(storePath, JSON.stringify({ spotifyRefreshToken: 'from-file' }));
        vi.stubEnv('AUTH_STORE_PATH', storePath);
        vi.stubEnv('SPOTIFY_REFRESH_TOKEN', '');
        loadStoredAuth(true);
        givenRotation();

        await getAccessToken();

        expect(refreshTokenSent(0)).toBe('from-file');
        expect(JSON.parse(readFileSync(storePath, 'utf8'))).toEqual({ spotifyRefreshToken: 'rotated-refresh' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('同じ refresh_token が返ってきただけなら何もしない', async () => {
      respondWith((url) =>
        url.includes('accounts.spotify.com/api/token')
          ? jsonOk({ access_token: 'a', expires_in: 3600, refresh_token: 'spec-refresh-token' })
          : null
      );

      await getAccessToken();

      expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
    });
  });
});
