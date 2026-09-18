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
import { nowPlayingCache, topTracksCache, moodCache } from '../cache/index.js';
import type {
  NowPlayingResponse,
  TopTracksResponse,
  StatusResponse,
  MoodResult,
} from '../types/index.js';

export interface CollectOptions {
  /** キャッシュを読まない。CLI の単発実行のように常に最新が要る場合に使う。 */
  bypassCache?: boolean;
  /** ムード生成を行わない。GROQ_API_KEY 無しで動かしたい場合に使う。 */
  skipMood?: boolean;
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

  let mood: MoodResult | null = null;
  if (!options.skipMood && data.isPlaying && data.track && data.trackId) {
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
        // ムードが出せなくても曲情報は返す（デグレード動作）
        console.error('[mood] LLM error (degraded mode):', err);
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
  options: CollectOptions = {}
): Promise<TopTracksResponse> {
  if (!options.bypassCache) {
    const cached = topTracksCache.get<TopTracksResponse>('top-tracks');
    if (cached) return cached;
  }

  const tracks = await fetchTopTracks();
  const response: TopTracksResponse = {
    range: 'short_term',
    fetched_at: new Date().toISOString(),
    tracks,
  };

  if (!options.bypassCache) cacheSet(topTracksCache, 'top-tracks', response);
  return response;
}

export async function collectStatus(options: CollectOptions = {}): Promise<StatusResponse> {
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
