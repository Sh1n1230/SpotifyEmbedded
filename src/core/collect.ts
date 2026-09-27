/**
 * HTTP フレームワークに依存しないデータ収集層。
 *
 * now-playing はライブAPI（src/routes/）と静的生成CLI（src/cli/generate.ts）の
 * 両方から、ランキングは CLI からだけ呼ばれる。ここが唯一の取得ロジックで、
 * 出力は src/types/index.ts のスキーマそのもの。静的モードとライブAPIで
 * now-playing が同じJSONになるのはこのため。
 */
import { fetchNowPlaying } from '../spotify/nowPlaying.js';
import { fetchTopTracks } from '../spotify/topTracks.js';
import { generateMood } from '../llm/moodGenerator.js';
import { hasLlmConfigured } from '../authStore.js';
import {
  nowPlayingCache,
  moodCache,
  getDurableStore,
  type TtlCache,
} from '../cache/index.js';
import {
  DEFAULT_TOP_TRACKS_RANGE,
  DEFAULT_TOP_TRACKS_LIMIT,
  type NowPlayingResponse,
  type TopTracksResponse,
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

export interface TopTracksOptions {
  /** 集計期間。既定は short_term（直近4週間）。 */
  range?: TopTracksRange;
  /** 取得件数（10 / 30 / 50）。既定は 50。 */
  limit?: TopTracksLimit;
}

/** maxKeys 超過時に set が throw する。保存失敗は致命的ではない。 */
function cacheSet(cache: TtlCache, key: string, value: unknown): void {
  try {
    cache.set(key, value);
  } catch {
    // キャッシュが満杯。次回は再取得になるだけなので無視する。
  }
}

/** 曲ごとのムード文の保持期間。メモリの moodCache と揃える。 */
const MOOD_TTL_SECONDS = 86400;

/**
 * メモリ → 外部ストアの順に引く。外部ストアで見つかればメモリにも載せる。
 * 外部ストアの障害は「見つからなかった」として扱う（生成し直すだけ）。
 */
async function readThrough<T>(cache: TtlCache, key: string, durableKey: string): Promise<T | null> {
  const hit = cache.get<T>(key);
  if (hit) return hit;

  const store = getDurableStore();
  if (!store) return null;
  try {
    const stored = await store.get<T>(durableKey);
    if (stored) cacheSet(cache, key, stored);
    return stored;
  } catch (err) {
    console.warn('[store] 読み込みに失敗しました:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function writeThrough(
  cache: TtlCache,
  key: string,
  durableKey: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  cacheSet(cache, key, value);
  const store = getDurableStore();
  if (!store) return;
  try {
    await store.put(durableKey, value, ttlSeconds);
  } catch (err) {
    console.warn('[store] 書き込みに失敗しました:', err instanceof Error ? err.message : err);
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
    mood = await readThrough<MoodResult>(moodCache, data.trackId, `mood:${data.trackId}`);

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
        await writeThrough(moodCache, data.trackId, `mood:${data.trackId}`, mood, MOOD_TTL_SECONDS);
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

/**
 * ランキングを取得する。静的モード（CLI）専用で、ライブAPIには出さない。
 *
 * ムード文はここでは付けない（mood: null）。ランキングのムード文は
 * snapshot.json を根拠に失効を判定するため、呼び出し側（generate）が決める。
 */
export async function collectTopTracks(options: TopTracksOptions = {}): Promise<TopTracksResponse> {
  const range = options.range ?? DEFAULT_TOP_TRACKS_RANGE;
  const limit = options.limit ?? DEFAULT_TOP_TRACKS_LIMIT;

  return {
    range,
    limit,
    fetched_at: new Date().toISOString(),
    mood: null,
    tracks: await fetchTopTracks(range, limit),
  };
}
