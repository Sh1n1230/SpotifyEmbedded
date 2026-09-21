/**
 * SpotifyEmbedded の仕様書（実行可能な形）。
 *
 * このファイルは「網羅率を上げるためのテスト」ではなく、
 * 「この製品が満たすと約束している振る舞い」を1本にまとめた仕様書である。
 * describe の見出しがそのまま要件になっている。
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { XMLValidator } from 'fast-xml-parser';
import yaml from 'js-yaml';

import { loadStoredAuth } from './authStore.js';
import { artCache, moodCache, nowPlayingCache, topTracksCache } from './cache/index.js';
import { collectNowPlaying, collectTopTracks } from './core/collect.js';
import { parseCount, parseLimit, parseRange } from './core/topTracksParams.js';
import { generate } from './cli/generate.js';
import { chatCompletion } from './llm/client.js';
import { renderNowPlayingCard } from './render/card.js';
import { renderRankingCard } from './render/ranking.js';
import {
  SpotifyApiError,
  SpotifyAuthError,
  spotifyFetch,
} from './spotify/client.js';
import { resetArtistGenreAvailability } from './spotify/artists.js';
import {
  TOP_TRACKS_RANGES,
  type SpotifyTrack,
  type TopTrackEntry,
  type TopTracksRange,
} from './types/index.js';

// ── 固定値 ───────────────────────────────────────────────────────────────────

/** 全テストで共有する固定時刻。出力のタイムスタンプはすべてこれになる。 */
const NOW = new Date('2026-09-21T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();

const ART_640 = 'https://i.scdn.co/image/ab67616d0000b273deadbeefdeadbeefdeadbeef';
const ART_300 = 'https://i.scdn.co/image/ab67616d00001e02deadbeefdeadbeefdeadbeef';
const ART_64 = 'https://i.scdn.co/image/ab67616d00004851deadbeefdeadbeefdeadbeef';

/** `TrackSummary` が持つと約束しているキー。欠損環境でも増減しない。 */
const TRACK_SUMMARY_KEYS = [
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
const TOP_TRACK_ENTRY_KEYS = [...TRACK_SUMMARY_KEYS, 'genres', 'rank'].sort();

/** LLM の設定を読みうる環境変数（別名を含む）。テストごとに全部潰す。 */
const LLM_ENV_NAMES = [
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

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** null を返すと「このハンドラは担当しない」の意味。後勝ちで解決する。 */
type Responder = (url: string, init: RequestInit | undefined) => Response | null;

let handlers: Responder[] = [];
let calls: RecordedCall[] = [];

function respondWith(handler: Responder): void {
  handlers.push(handler);
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function callsTo(fragment: string): RecordedCall[] {
  return calls.filter((call) => call.url.includes(fragment));
}

function headerOf(call: RecordedCall, name: string): string | undefined {
  return (call.init?.headers as Record<string, string> | undefined)?.[name];
}

function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body ?? '{}')) as Record<string, unknown>;
}

/** 毎テスト共通の土台となるハンドラ（テスト側は後から上書きできる）。 */
function installDefaultHandlers(): void {
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
function aSpotifyTrack(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
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

function aTopTrackEntry(overrides: Partial<TopTrackEntry> = {}): TopTrackEntry {
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

function givenNowPlaying(track: SpotifyTrack | null): void {
  respondWith((url) => {
    if (!url.includes('/me/player/currently-playing')) return null;
    // 停止中・デバイスなしは 204（本文なし）
    if (!track) return new Response(null, { status: 204 });
    return jsonOk({ is_playing: true, progress_ms: 1000, item: track, timestamp: NOW.getTime() });
  });
}

function givenTopTracks(items: SpotifyTrack[]): void {
  respondWith((url) => (url.includes('/me/top/tracks') ? jsonOk({ items }) : null));
}

/** ジャンルが返る環境（extended quota mode）を模す。 */
function givenArtistGenres(genres: Record<string, string[]>): void {
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

function givenLlmConfigured(baseUrl = 'https://api.groq.com/openai/v1'): void {
  vi.stubEnv('LLM_API_KEY', 'spec-llm-key');
  vi.stubEnv('LLM_BASE_URL', baseUrl);
  vi.stubEnv('LLM_MODEL', 'spec-model');
}

function givenLlmReplies(content: string): void {
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

  // node-cache のインスタンスはモジュール共有。消さないとテスト順序で結果が変わる。
  for (const cache of [nowPlayingCache, topTracksCache, moodCache, artCache]) cache.flushAll();
  // /artists の 403 latch はプロセス単位の状態。
  resetArtistGenreAvailability();

  handlers = [];
  calls = [];
  installDefaultHandlers();

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
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

// ─────────────────────────────────────────────────────────────────────────────
// 要件1
// ─────────────────────────────────────────────────────────────────────────────

describe('要件1: Spotify API を叩いて、直近3種類のランキングを取得できる', () => {
  it.each(TOP_TRACKS_RANGES)(
    '%s を指定すると、その time_range で /me/top/tracks を叩き、応答にも反映される',
    async (range: TopTracksRange) => {
      givenTopTracks([aSpotifyTrack()]);

      const result = await collectTopTracks({ range });

      const [call] = callsTo('/me/top/tracks');
      expect(call).toBeDefined();
      expect(call!.url).toContain(`time_range=${range}`);
      expect(headerOf(call!, 'Authorization')).toMatch(/^Bearer .+/);
      expect(result.range).toBe(range);
      expect(result.fetched_at).toBe(NOW_ISO);
    }
  );

  it('3種類すべてを同じプロセスで取得でき、期間ごとにキャッシュが分離される', async () => {
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

    // 2周目はすべてキャッシュから返るので、Spotify への往復は増えない
    for (const range of TOP_TRACKS_RANGES) {
      const result = await collectTopTracks({ range });
      expect(result.tracks[0]!.name).toBe(range);
    }
    expect(callsTo('/me/top/tracks')).toHaveLength(3);
  });

  it('取得件数として指定できるのは 10 / 30 / 50 のみで、それ以外は黙って既定の50に倒れる', () => {
    // Spotify 側は 1〜50 の任意値を許すが、キャッシュキーの組み合わせを
    // 抑えるため3段階に固定している（意図的な制約であって未実装ではない）。
    expect(parseLimit('10')).toBe(10);
    expect(parseLimit('30')).toBe(30);
    expect(parseLimit('50')).toBe(50);

    // 埋め込み先で壊れないことを優先し、不正値は例外にせず既定へ倒す
    expect(parseLimit('20')).toBe(50);
    expect(parseLimit('abc')).toBe(50);
    expect(parseLimit(undefined)).toBe(50);
  });

  it('期間も不正値は既定（short_term）に倒れる', () => {
    expect(parseRange('MEDIUM_TERM')).toBe('medium_term');
    expect(parseRange('6months')).toBe('short_term');
    expect(parseRange(undefined)).toBe('short_term');
  });

  it('表示件数は任意の数を受け付け、1〜50に丸められる', () => {
    expect(parseCount('7')).toBe(7);
    expect(parseCount('0')).toBe(1);
    expect(parseCount('999')).toBe(50);
    expect(parseCount(undefined)).toBe(5);
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

// ─────────────────────────────────────────────────────────────────────────────
// 要件2
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// 要件3
// ─────────────────────────────────────────────────────────────────────────────

describe('要件3: ランキングの静的な画像を得られる', () => {
  function render(tracks: TopTrackEntry[], count = 5): string {
    return renderRankingCard({
      tracks,
      fetchedAt: NOW_ISO,
      range: 'short_term',
      count,
      theme: 'dark',
    });
  }

  it('XMLとして妥当なSVGを返す', () => {
    const svg = render([aTopTrackEntry()]);

    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Midnight Drive');
  });

  it('曲名やアーティスト名にXMLの特殊文字が入っても壊れない', () => {
    // ここが壊れると GitHub 上で画像が「表示されない」形で失敗する。
    // テキストノードだけでなく aria-label などの属性値にも差し込まれるため、
    // 正規表現ではなく実際にパースして確かめる。
    const nasty = 'Rock & Roll <script>alert("x")</script> \'quoted\'';
    const svg = render([aTopTrackEntry({ name: nasty, artist: nasty, album: nasty })]);

    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&amp;');
  });

  it('表示件数は count 件までに絞られる', () => {
    const tracks = Array.from({ length: 20 }, (_, i) =>
      aTopTrackEntry({ rank: i + 1, id: `track-${i}`, name: `Track ${i}` })
    );

    const svg = render(tracks, 3);

    expect(svg).toContain('Track 0');
    expect(svg).toContain('Track 2');
    expect(svg).not.toContain('Track 3');
  });

  it('1件も無いときは空白ではなく「データがありません」を描く', () => {
    const svg = render([]);

    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain('データがありません');
  });

  it('集計期間が見出しに出る', () => {
    const svg = renderRankingCard({
      tracks: [aTopTrackEntry()],
      fetchedAt: NOW_ISO,
      range: 'long_term',
      count: 5,
    });

    expect(svg).toContain('1 YEAR');
  });

  it('dark / light の2テーマを描ける', () => {
    const dark = render([aTopTrackEntry()]);
    const light = renderRankingCard({
      tracks: [aTopTrackEntry()],
      fetchedAt: NOW_ISO,
      range: 'short_term',
      count: 5,
      theme: 'light',
    });

    expect(XMLValidator.validate(light)).toBe(true);
    expect(light).not.toBe(dark);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 要件4
// ─────────────────────────────────────────────────────────────────────────────

describe('要件4: GitHub Actions から定期的にランキング画像を更新できる', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'spotify-embedded-spec-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  function runGenerate(): Promise<void> {
    return generate({
      outDir,
      count: 5,
      range: 'short_term',
      limit: 50,
      theme: 'both',
      skipMood: true,
    });
  }

  function read(name: string): string {
    return readFileSync(join(outDir, name), 'utf8');
  }

  describe('生成される成果物', () => {
    it('SVG / JSON / YAML / HTML を出力先に書き出す', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      for (const name of [
        'now-playing.svg',
        'now-playing-light.svg',
        'ranking.svg',
        'ranking-light.svg',
        'now-playing.json',
        'top-tracks.json',
        'now-playing.yaml',
        'top-tracks.yaml',
        'index.html',
        'snapshot.json',
      ]) {
        expect(read(name).length).toBeGreaterThan(0);
      }
    });

    it('書き出したSVGはXMLとして妥当である', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      for (const name of ['now-playing.svg', 'ranking.svg', 'ranking-light.svg']) {
        expect(XMLValidator.validate(read(name))).toBe(true);
      }
    });

    it('ジャケ写は外部参照ではなく data URI として焼き込まれる', async () => {
      // GitHub の camo プロキシは SVG 内の外部 <image href> を描画しない。
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      expect(read('ranking.svg')).toContain('data:image/jpeg;base64,');
      expect(read('ranking.svg')).not.toContain('href="https://i.scdn.co');
    });
  });

  describe('停止中でも空にならない（スナップショットの引き継ぎ）', () => {
    it('前回の観測を引き継ぎ、observed_at は更新しない', async () => {
      // 1回目: 再生中
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      const first = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      expect(first['state']).toBe('playing');
      expect(first['observed_at']).toBe(NOW_ISO);

      // 2回目: 30分後、Spotify は停止している
      const later = new Date(NOW.getTime() + 30 * 60 * 1000);
      vi.setSystemTime(later);
      handlers = [];
      calls = [];
      installDefaultHandlers();
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      const second = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      expect(second['state']).toBe('recent');
      expect((second['track'] as { name: string }).name).toBe('Midnight Drive');
      // ここを更新すると「たった今聴いていた」のまま固まってしまう
      expect(second['observed_at']).toBe(NOW_ISO);
      expect(second['observed_at']).not.toBe(later.toISOString());
    });

    it('引き継げる前回データも無ければ idle として生成する', async () => {
      givenNowPlaying(null);
      givenTopTracks([]);

      await runGenerate();

      const snapshot = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      expect(snapshot['state']).toBe('idle');
      expect(snapshot['track']).toBeNull();
      expect(XMLValidator.validate(read('now-playing.svg'))).toBe(true);
    });
  });

  describe('ワークフロー定義 (.github/workflows/update-spotify.yml)', () => {
    interface Step {
      name?: string;
      run?: string;
      env?: Record<string, string>;
    }
    interface Workflow {
      on: { schedule?: { cron: string }[] };
      concurrency: { 'cancel-in-progress': boolean };
      permissions: Record<string, string>;
      jobs: Record<string, { steps: Step[] }>;
    }

    const workflow = yaml.load(
      readFileSync(new URL('../.github/workflows/update-spotify.yml', import.meta.url), 'utf8')
    ) as Workflow;
    const steps = workflow.jobs['update']!.steps;
    const allRunScripts = steps.map((step) => step.run ?? '').join('\n');

    it('定期実行のスケジュールが設定されている', () => {
      // 間隔そのものは仕様ではない（GitHub 側で遅延・間引きされるため、
      // 30分という数字に意味を持たせていない）。定期実行の口があることを見る。
      expect(workflow.on.schedule?.length).toBeGreaterThan(0);
      expect(workflow.on.schedule![0]!.cron).toMatch(/^\S+( \S+){4}$/);
    });

    it('ランキング画像を生成するステップがある', () => {
      expect(allRunScripts).toContain('generate');
      expect(allRunScripts).toContain('--range');
      expect(allRunScripts).toContain('--count');
      expect(allRunScripts).toContain('--theme');
    });

    it('生成ステップに Spotify の資格情報が渡っている', () => {
      const env = steps.find((step) => (step.run ?? '').includes('generate'))?.env ?? {};
      for (const name of [
        'SPOTIFY_CLIENT_ID',
        'SPOTIFY_CLIENT_SECRET',
        'SPOTIFY_REFRESH_TOKEN',
      ]) {
        expect(env).toHaveProperty(name);
      }
    });

    it('公開ブランチから前回の snapshot.json を復元するステップがある', () => {
      // これが無いと、停止中の引き継ぎが毎回リセットされる
      expect(allRunScripts).toContain('snapshot.json');
    });

    it('公開ブランチへ push する', () => {
      expect(allRunScripts).toContain('spotify-data');
      expect(allRunScripts).toContain('git push');
      expect(workflow.permissions['contents']).toBe('write');
    });

    it('実行中のジョブを途中で中断しない', () => {
      // push の途中で殺されると公開ブランチに中途半端な状態が残る
      expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 要件5（実測由来: 落ちるのはいつも LLM 側だった）
// ─────────────────────────────────────────────────────────────────────────────

describe('要件5: LLM は任意機能であり、何が起きても曲情報は出る', () => {
  it('LLM が未設定なら、そもそも呼びに行かず mood: null で返す', async () => {
    givenNowPlaying(aSpotifyTrack());

    const result = await collectNowPlaying();

    expect(callsTo('/chat/completions')).toHaveLength(0);
    expect(result.mood).toBeNull();
    expect(result.track).not.toBeNull();
  });

  it('LLM が設定されていればムード文を載せる', async () => {
    givenLlmConfigured();
    givenLlmReplies('今チルな気分になっています');
    givenNowPlaying(aSpotifyTrack());

    const result = await collectNowPlaying();

    expect(result.mood?.text).toBe('今チルな気分になっています');
    expect(result.mood?.generated_at).toBe(NOW_ISO);
  });

  it('モデルがクォートで囲んできたら外す', async () => {
    givenLlmConfigured();
    givenLlmReplies('「今ノリノリなようです」');
    givenNowPlaying(aSpotifyTrack());

    const result = await collectNowPlaying();

    expect(result.mood?.text).toBe('今ノリノリなようです');
  });

  it('モデルが句点を付けてきたら落とす', async () => {
    // プロンプトの文例には句点を付けていないが、Gemini などは付けてくる。
    givenLlmConfigured();
    givenLlmReplies('今ノリノリなようです。');
    givenNowPlaying(aSpotifyTrack());

    const result = await collectNowPlaying();

    expect(result.mood?.text).toBe('今ノリノリなようです');
  });

  // 【既知の不具合】クォートと句点が重なると閉じ括弧が残る。
  // moodGenerator の後処理がクォート除去 → 句点除去の順なので、
  // 「…」。 では末尾が 。 のうちに ["」]$ を試してしまい 」 を取り逃す。
  // 順序を入れ替えれば直る。直したらこのテストを it に戻すこと。
  it.fails('「…」。 の形でも閉じ括弧まで取り除く', async () => {
    givenLlmConfigured();
    givenLlmReplies('「今ノリノリなようです」。');
    givenNowPlaying(aSpotifyTrack());

    const result = await collectNowPlaying();

    expect(result.mood?.text).toBe('今ノリノリなようです');
  });

  it('取得できなかった手がかりはプロンプトに書かない', async () => {
    // 「ジャンル: 不明」のように空の手がかりを示すと、そこに引きずられた
    // 文が返ってくる。行ごと落とすのが仕様。
    givenLlmConfigured();
    givenLlmReplies('今チルな気分になっています');
    givenNowPlaying(aSpotifyTrack());

    await collectNowPlaying();

    const body = bodyOf(callsTo('/chat/completions')[0]!);
    const prompt = (body['messages'] as { content: string }[])[1]!.content;
    expect(prompt).toContain('曲名: Midnight Drive');
    expect(prompt).not.toContain('ジャンル');
    expect(prompt).not.toContain('人気度');
    expect(prompt).not.toContain('不明');
  });

  describe('LLM が失敗しても曲情報は返る（デグレード動作）', () => {
    it('応答が空（推論モデルが出力上限を使い切った）でも完走する', async () => {
      givenLlmConfigured();
      givenLlmReplies('');
      givenNowPlaying(aSpotifyTrack());

      const result = await collectNowPlaying();

      expect(result.mood).toBeNull();
      expect(result.track?.name).toBe('Midnight Drive');
    });

    it('認証エラーでも完走する', async () => {
      givenLlmConfigured();
      respondWith((url) =>
        url.includes('/chat/completions') ? new Response('nope', { status: 401 }) : null
      );
      givenNowPlaying(aSpotifyTrack());

      const result = await collectNowPlaying();

      expect(result.mood).toBeNull();
      expect(result.track).not.toBeNull();
    });

    it('タイムアウトしても完走する', async () => {
      givenLlmConfigured();
      respondWith((url) => {
        if (!url.includes('/chat/completions')) return null;
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      });
      givenNowPlaying(aSpotifyTrack());

      const result = await collectNowPlaying();

      expect(result.mood).toBeNull();
      expect(result.track).not.toBeNull();
    });
  });

  describe('失敗の原因が分かるメッセージになる', () => {
    function callLlm(baseUrl = 'https://api.groq.com/openai/v1'): Promise<string> {
      return chatCompletion({
        baseUrl,
        apiKey: 'spec-llm-key',
        model: 'spec-model',
        messages: [{ role: 'user', content: 'hi' }],
      });
    }

    it.each([
      [401, /APIキー/],
      [404, /モデル/],
      [429, /レート制限/],
    ])('%i は原因を説明する', async (status, pattern) => {
      respondWith((url) =>
        url.includes('/chat/completions') ? new Response('{}', { status: status as number }) : null
      );

      await expect(callLlm()).rejects.toThrow(pattern as RegExp);
    });

    it('応答が空なら、推論で使い切った可能性を示す', async () => {
      givenLlmReplies('   ');

      await expect(callLlm()).rejects.toThrow(/推論/);
    });

    it('5xx は一度だけ間を置いて引き直す', async () => {
      let attempt = 0;
      respondWith((url) => {
        if (!url.includes('/chat/completions')) return null;
        attempt += 1;
        return attempt === 1
          ? new Response('busy', { status: 503 })
          : jsonOk({ choices: [{ message: { content: 'もう一度で通りました' } }] });
      });

      await expect(callLlm()).resolves.toBe('もう一度で通りました');
      expect(attempt).toBe(2);
    });

    it('引き直しても 5xx なら諦める', async () => {
      respondWith((url) =>
        url.includes('/chat/completions') ? new Response('busy', { status: 503 }) : null
      );

      await expect(callLlm()).rejects.toThrow(/混雑/);
      expect(callsTo('/chat/completions')).toHaveLength(2);
    });

    describe('推論の無効化パラメータは相手によって形が違う', () => {
      // 対応していない相手に送ると 400 になるため、宛先で出し分ける。
      // プロバイダを足したときに他所へ余計なパラメータが飛ぶ回帰は、
      // 型検査では防げない。
      it('OpenRouter には reasoning: { effort: "none" }', async () => {
        givenLlmReplies('ok');

        await callLlm('https://openrouter.ai/api/v1');

        const body = bodyOf(callsTo('/chat/completions')[0]!);
        expect(body['reasoning']).toEqual({ effort: 'none' });
        expect(body).not.toHaveProperty('reasoning_effort');
      });

      it('Gemini には reasoning_effort: "none"', async () => {
        givenLlmReplies('ok');

        await callLlm('https://generativelanguage.googleapis.com/v1beta/openai');

        const body = bodyOf(callsTo('/chat/completions')[0]!);
        expect(body['reasoning_effort']).toBe('none');
        expect(body).not.toHaveProperty('reasoning');
      });

      it('それ以外には何も送らない', async () => {
        givenLlmReplies('ok');

        await callLlm('https://api.groq.com/openai/v1');

        const body = bodyOf(callsTo('/chat/completions')[0]!);
        expect(body).not.toHaveProperty('reasoning');
        expect(body).not.toHaveProperty('reasoning_effort');
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 土台となる契約
// ─────────────────────────────────────────────────────────────────────────────

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

  it('204（本文なし）は null を返す', async () => {
    respondWith((url) =>
      url.includes('/me/player/currently-playing') ? new Response(null, { status: 204 }) : null
    );

    await expect(spotifyFetch('/me/player/currently-playing')).resolves.toBeNull();
  });

  it('429 は Retry-After 付きの SpotifyRateLimitError', async () => {
    respondWith((url) =>
      url.includes('/me/top/tracks')
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } })
        : null
    );

    await expect(spotifyFetch('/me/top/tracks')).rejects.toMatchObject({
      name: 'SpotifyRateLimitError',
      retryAfter: 7,
    });
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

describe('静的モードとライブAPIは同一のJSONスキーマを出す', () => {
  // 利用者が fetch 先のURLを差し替えるだけで静的↔ライブを行き来できる、
  // というのがこの製品の中核。崩すと静かに互換性が失われる。
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'spotify-embedded-spec-schema-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('out/*.json は collect*() の戻り値と一致する', async () => {
    givenNowPlaying(aSpotifyTrack());
    givenTopTracks([aSpotifyTrack(), aSpotifyTrack({ id: 'track-2', name: 'Second' })]);

    await generate({
      outDir,
      count: 5,
      range: 'medium_term',
      limit: 30,
      theme: 'dark',
      skipMood: true,
    });

    const liveNowPlaying = await collectNowPlaying({ bypassCache: true, skipMood: true });
    const liveTopTracks = await collectTopTracks({
      bypassCache: true,
      range: 'medium_term',
      limit: 30,
    });

    expect(JSON.parse(readFileSync(join(outDir, 'now-playing.json'), 'utf8'))).toEqual(
      liveNowPlaying
    );
    expect(JSON.parse(readFileSync(join(outDir, 'top-tracks.json'), 'utf8'))).toEqual(
      liveTopTracks
    );
  });

  it('YAML も同じ内容を表す', async () => {
    givenNowPlaying(aSpotifyTrack());
    givenTopTracks([aSpotifyTrack()]);

    await generate({
      outDir,
      count: 5,
      range: 'short_term',
      limit: 50,
      theme: 'dark',
      skipMood: true,
    });

    const asJson = JSON.parse(readFileSync(join(outDir, 'top-tracks.json'), 'utf8')) as unknown;
    const asYaml = yaml.load(readFileSync(join(outDir, 'top-tracks.yaml'), 'utf8'));

    expect(asYaml).toEqual(asJson);
  });
});
