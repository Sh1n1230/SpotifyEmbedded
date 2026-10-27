/**
 * SpotifyEmbedded の仕様書（実行可能な形）の共通部分。
 *
 * このファイルは「網羅率を上げるためのテスト」ではなく、
 * 「この製品が満たすと約束している振る舞い」をまとめた仕様書である。
 * src/spec/*.test.ts の describe の見出しがそのまま要件になっている。
 *
 * このモジュールは import されると、そのテストファイルに共通の beforeEach / afterEach を
 * 登録する（時刻の固定・環境変数・fetch のモック・キャッシュの初期化）。
 *
 * 方針:
 * - モックは `fetch` の層で行う。モジュールごと差し替えると
 *   「どのURLを・どのクエリで・どのヘッダで叩いたか」が検証対象から消え、
 *   「Spotify API を叩くことで〜できる」という要件そのものが抜け落ちる。
 * - 時刻は固定する。出力のほぼ全てに ISO 8601 のタイムスタンプが入るため、
 *   固定しないと「スナップショットの observed_at を更新しない」のような
 *   等値比較の仕様が書けない。
 * - フィクスチャの既定値は「2024年11月以降に作成された Spotify アプリ」、
 *   すなわち popularity / genres / preview_url が返ってこない世界とする。
 *   現実の大多数がこちらで、かつ「欠けていてもキーは必ず存在する」という
 *   スキーマ契約が既定ケースで検証される。
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadStoredAuth } from '../authStore.js';
import { artCache, moodCache, nowPlayingCache, setDurableStore } from '../cache/index.js';
import { resetArtistGenreAvailability } from '../spotify/artists.js';
import type { SpotifyTrack, TopTrackEntry } from '../types/index.js';

// ── 固定値 ───────────────────────────────────────────────────────────────────

/** 全テストで共有する固定時刻。出力のタイムスタンプはすべてこれになる。 */
export const NOW = new Date('2026-09-21T12:00:00.000Z');
export const NOW_ISO = NOW.toISOString();

export const ART_640 = 'https://i.scdn.co/image/ab67616d0000b273deadbeefdeadbeefdeadbeef';
export const ART_300 = 'https://i.scdn.co/image/ab67616d00001e02deadbeefdeadbeefdeadbeef';
export const ART_64 = 'https://i.scdn.co/image/ab67616d00004851deadbeefdeadbeefdeadbeef';

/** `TrackSummary` が持つと約束しているキー。欠損環境でも増減しない。 */
export const TRACK_SUMMARY_KEYS = [
  'album',
  'album_art_url',
  'artist',
  'duration_ms',
  'id',
  'name',
  'popularity',
  'preview_url',
  'spotify_url',
];

/** `TopTrackEntry` は `TrackSummary` に rank と genres を足したもの。 */
export const TOP_TRACK_ENTRY_KEYS = [...TRACK_SUMMARY_KEYS, 'genres', 'rank'].sort();

/** LLM の設定を読みうる環境変数（別名を含む）。テストごとに全部潰す。 */
export const LLM_ENV_NAMES = [
  'LLM_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'LLM_BASE_URL',
  'OPENAI_BASE_URL',
  'LLM_MODEL',
  'GROQ_MODEL',
];

// ── fetch モック ─────────────────────────────────────────────────────────────

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** null を返すと「このハンドラは担当しない」の意味。後勝ちで解決する。 */
export type Responder = (url: string, init: RequestInit | undefined) => Response | null;

let handlers: Responder[] = [];
export let calls: RecordedCall[] = [];

/** テストの途中で「別の実行」を模すときに、それまでのハンドラを捨てる。 */
export function clearHandlers(): void {
  handlers = [];
}

export function clearCalls(): void {
  calls = [];
}

export function respondWith(handler: Responder): void {
  handlers.push(handler);
}

export function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export function callsTo(fragment: string): RecordedCall[] {
  return calls.filter((call) => call.url.includes(fragment));
}

export function headerOf(call: RecordedCall, name: string): string | undefined {
  return (call.init?.headers as Record<string, string> | undefined)?.[name];
}

export function bodyOf(call: RecordedCall): Record<string, unknown> {
  const body = call.init?.body ?? '{}';
  if (typeof body !== 'string') throw new TypeError('リクエストの本文が文字列ではありません');
  return JSON.parse(body) as Record<string, unknown>;
}

/** 毎テスト共通の土台となるハンドラ（テスト側は後から上書きできる）。 */
export function installDefaultHandlers(): void {
  respondWith((url) =>
    url.includes('accounts.spotify.com/api/token')
      ? jsonOk({ access_token: 'spec-access-token', expires_in: 3600 })
      : null
  );
  respondWith((url) =>
    url.includes('.scdn.co')
      ? new Response(Buffer.from('fake-jpeg-bytes'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      : null
  );
  // 既定では再生履歴は空（引き継ぎの仕様を履歴なしで検証できるように）
  respondWith((url) => (url.includes('/me/player/recently-played') ? jsonOk({ items: [] }) : null));
  // 既定では 2024年11月以降のアプリ: /artists?ids= は 403 で拒否される
  respondWith((url) =>
    url.includes('/artists?ids=') ? new Response('forbidden', { status: 403 }) : null
  );
}

// ── フィクスチャ ─────────────────────────────────────────────────────────────

/**
 * Spotify が返す生のトラック。
 * 既定では popularity も preview_url も「キーごと無い」— これが
 * 2024年11月以降に作成されたアプリで実際に返ってくる形。
 */
export function aSpotifyTrack(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    id: 'track-1',
    name: 'Midnight Drive',
    artists: [
      {
        id: 'artist-1',
        name: 'Neon District',
        external_urls: { spotify: 'https://open.spotify.com/artist/artist-1' },
      },
    ],
    album: {
      name: 'After Hours',
      images: [
        { url: ART_640, width: 640, height: 640 },
        { url: ART_300, width: 300, height: 300 },
        { url: ART_64, width: 64, height: 64 },
      ],
      release_date: '2025-04-01',
    },
    duration_ms: 213_000,
    explicit: false,
    external_urls: { spotify: 'https://open.spotify.com/track/track-1' },
    ...overrides,
  };
}

/**
 * Spotify クライアントに取り込んだローカルファイル。Spotify はこれを id・external_urls・
 * アーティストの id が空の形で返す（型の上では string だが、実際は null）。
 * https://developer.spotify.com/documentation/web-api/concepts/playlists#local-files
 */
export function aLocalFileTrack(): SpotifyTrack {
  const none = null as unknown as string;
  return aSpotifyTrack({
    id: none,
    is_local: true,
    name: 'My Demo',
    artists: [{ id: none, name: 'Local Artist', external_urls: {} as { spotify: string } }],
    album: { name: 'Local Album', images: [], release_date: '' },
    external_urls: {} as { spotify: string },
  });
}

export function aTopTrackEntry(overrides: Partial<TopTrackEntry> = {}): TopTrackEntry {
  return {
    rank: 1,
    id: 'track-1',
    name: 'Midnight Drive',
    artist: 'Neon District',
    album: 'After Hours',
    album_art_url: ART_300,
    duration_ms: 213_000,
    popularity: null,
    genres: [],
    spotify_url: 'https://open.spotify.com/track/track-1',
    preview_url: null,
    ...overrides,
  };
}

// ── モックの組み立て ─────────────────────────────────────────────────────────

export function givenNowPlaying(track: SpotifyTrack | null): void {
  respondWith((url) => {
    if (!url.includes('/me/player/currently-playing')) return null;
    // 停止中・デバイスなしは 204（本文なし）
    if (!track) return new Response(null, { status: 204 });
    return jsonOk({ is_playing: true, progress_ms: 1000, item: track, timestamp: NOW.getTime() });
  });
}

export function givenRecentlyPlayed(track: SpotifyTrack, playedAt: string): void {
  respondWith((url) =>
    url.includes('/me/player/recently-played')
      ? jsonOk({ items: [{ track, played_at: playedAt }] })
      : null
  );
}

export function givenTopTracks(items: SpotifyTrack[]): void {
  respondWith((url) => (url.includes('/me/top/tracks') ? jsonOk({ items }) : null));
}

/** ジャンルが返る環境（extended quota mode）を模す。 */
export function givenArtistGenres(genres: Record<string, string[]>): void {
  respondWith((url) => {
    if (!url.includes('/artists?ids=')) return null;
    const ids = decodeURIComponent(url.split('ids=')[1] ?? '').split(',');
    return jsonOk({
      artists: ids.map((id) => ({
        id,
        name: id,
        external_urls: { spotify: `https://open.spotify.com/artist/${id}` },
        genres: genres[id] ?? [],
      })),
    });
  });
}

export function givenLlmConfigured(baseUrl = 'https://api.groq.com/openai/v1'): void {
  vi.stubEnv('LLM_API_KEY', 'spec-llm-key');
  vi.stubEnv('LLM_BASE_URL', baseUrl);
  vi.stubEnv('LLM_MODEL', 'spec-model');
}

export function givenLlmReplies(content: string): void {
  respondWith((url) =>
    url.includes('/chat/completions') ? jsonOk({ choices: [{ message: { content } }] }) : null
  );
}

// ── セットアップ ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  // 開発機の設定ファイルが紛れ込むと結果が機械ごとに変わる。存在しないパスを
  // 指して強制再読込し、認証情報はテストから明示的に与える。
  vi.stubEnv('AUTH_STORE_PATH', join(tmpdir(), 'spotify-embedded-spec-nonexistent.json'));
  for (const name of LLM_ENV_NAMES) vi.stubEnv(name, '');
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'spec-client-id');
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'spec-client-secret');
  vi.stubEnv('SPOTIFY_REFRESH_TOKEN', 'spec-refresh-token');
  loadStoredAuth(true);

  // キャッシュのインスタンスはモジュール共有。消さないとテスト順序で結果が変わる。
  for (const cache of [nowPlayingCache, moodCache, artCache]) {
    cache.flushAll();
  }
  setDurableStore(null);
  // /artists の 403 latch はプロセス単位の状態。
  resetArtistGenreAvailability();

  handlers = [];
  calls = [];
  installDefaultHandlers();

  // fetch の代わりなので Promise を返す（ハンドラは同期のものもある）
  // eslint-disable-next-line @typescript-eslint/require-await -- fetch と同じ型にするため
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
      const res = handlers[i]!(url, init);
      if (res) return res;
    }
    throw new Error(`モックされていないリクエスト: ${url}`);
  });

  // 生成処理は進捗と警告を大量に出す。仕様の検証には不要なので黙らせる。
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
