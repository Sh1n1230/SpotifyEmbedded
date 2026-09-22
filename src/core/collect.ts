/**
 * Express に依存しないデータ収集層。
 *
 * ライブAPI（src/routes/）と静的生成CLI（src/cli/generate.ts）の両方から
 * 呼ばれる。ここが唯一の取得ロジックで、出力は src/types/index.ts の
 * スキーマそのもの。静的モードとライブAPIで同じJSONが出るのはこのため。
 */
import { fetchNowPlaying } from '../spotify/nowPlaying.js';
import { fetchTopTracks } from '../spotify/topTracks.js';
import { generateMood } from '../llm/moodGenerator.js';
import { hasLlmConfigured } from '../authStore.js';
import { resolveRankingMood, type RankingMoodRecord } from './rankingMood.js';
import {
  nowPlayingCache,
  topTracksCache,
  moodCache,
  rankingMoodCache,
} from '../cache/index.js';
import {
  DEFAULT_TOP_TRACKS_RANGE,
  DEFAULT_TOP_TRACKS_LIMIT,
  type NowPlayingResponse,
  type TopTracksResponse,
  type StatusResponse,
  type MoodResult,
  type TopTracksRange,
  type TopTracksLimit,
} from '../types/index.js';

export interface CollectOptions {
  /** キャッシュを読まない。CLI の単発実行のように常に最新が要る場合に使う。 */
  bypassCache?: boolean;
  /** ムード生成を行わない。LLMキーが未設定の場合は指定しなくても自動で省く。 */
  skipMood?: boolean;
}

export interface TopTracksOptions extends CollectOptions {
  /** 集計期間。既定は short_term（直近4週間）。 */
  range?: TopTracksRange;
  /** 取得件数（10 / 30 / 50）。既定は 50。 */
  limit?: TopTracksLimit;
}

/** node-cache は maxKeys 超過時に set が throw する。保存失敗は致命的ではない。 */
function cacheSet(cache: typeof moodCache, key: string, value: unknown): void {
  try {
    cache.set(key, value);
  } catch {
    // キャッシュが満杯。次回は再取得になるだけなので無視する。
  }
}

export async function collectNowPlaying(
  options: CollectOptions = {}
): Promise<NowPlayingResponse> {
  if (!options.bypassCache) {
    const cached = nowPlayingCache.get<NowPlayingResponse>('now-playing');
    if (cached) return cached;
  }

  const data = await fetchNowPlaying();

  // LLMが未設定なら、呼びに行かず静かに省く（曲情報だけで成立する）
  const wantMood = !options.skipMood && hasLlmConfigured();

  let mood: MoodResult | null = null;
  if (wantMood && data.isPlaying && data.track && data.trackId) {
    mood = moodCache.get<MoodResult>(data.trackId) ?? null;

    if (!mood) {
      try {
        const text = await generateMood({
          trackName: data.track.name,
          artistName: data.track.artist,
          albumName: data.track.album,
          genres: data.genres,
          popularity: data.track.popularity,
        });
        mood = { text, generated_at: new Date().toISOString() };
        cacheSet(moodCache, data.trackId, mood);
      } catch (err) {
        // ムードが出せなくても曲情報は返す（デグレード動作）。
        // 原因が伝わればよいので、スタックトレースは出さない。
        console.error(
          '[mood] ムード文を省略しました:',
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  const response: NowPlayingResponse = {
    is_playing: data.isPlaying,
    track: data.track,
    mood,
    fetched_at: new Date().toISOString(),
  };

  if (!options.bypassCache) cacheSet(nowPlayingCache, 'now-playing', response);
  return response;
}

export async function collectTopTracks(
  options: TopTracksOptions = {}
): Promise<TopTracksResponse> {
  const range = options.range ?? DEFAULT_TOP_TRACKS_RANGE;
  const limit = options.limit ?? DEFAULT_TOP_TRACKS_LIMIT;
  // 期間・件数ごとに別物なのでキャッシュキーを分ける（組み合わせは最大9通り）。
  const cacheKey = `top-tracks:${range}:${limit}`;

  if (!options.bypassCache) {
    const cached = topTracksCache.get<TopTracksResponse>(cacheKey);
    if (cached) return cached;
  }

  const tracks = await fetchTopTracks(range, limit);
  const wantMood = !options.skipMood && hasLlmConfigured();
  const record = wantMood ? await liveRankingMood(range, tracks) : null;

  const response: TopTracksResponse = {
    range,
    limit,
    fetched_at: new Date().toISOString(),
    mood: record?.mood ?? null,
    tracks,
  };

  if (!options.bypassCache) cacheSet(topTracksCache, cacheKey, response);
  return response;
}

/** 期間ごとの生成中の Promise。limit 違いの同時リクエストで二重に呼ばないため。 */
const pendingRankingMoods = new Map<TopTracksRange, Promise<RankingMoodRecord | null>>();

/**
 * ライブAPI用。前回の結果はメモリに持つ（期間ごとに1件、期限なし）。
 * 静的モードは snapshot.json を使うので、ここは通らない。
 */
function liveRankingMood(
  range: TopTracksRange,
  tracks: TopTracksResponse['tracks']
): Promise<RankingMoodRecord | null> {
  const pending = pendingRankingMoods.get(range);
  if (pending) return pending;

  const previous = rankingMoodCache.get<RankingMoodRecord>(range) ?? null;
  const promise = resolveRankingMood(range, tracks, previous)
    .then((record) => {
      if (record) cacheSet(rankingMoodCache, range, record);
      return record;
    })
    .finally(() => pendingRankingMoods.delete(range));

  pendingRankingMoods.set(range, promise);
  return promise;
}

export async function collectStatus(options: TopTracksOptions = {}): Promise<StatusResponse> {
  const [now_playing, top_tracks] = await Promise.all([
    collectNowPlaying(options),
    collectTopTracks(options),
  ]);

  return {
    now_playing,
    top_tracks,
    generated_at: new Date().toISOString(),
  };
}
