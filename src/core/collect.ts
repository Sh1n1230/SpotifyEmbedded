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
import { fetchRecentlyPlayed } from '../spotify/recentlyPlayed.js';
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
  type TrackSummary,
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

/** 曲ごとのムード文。キャッシュに無ければ生成する。失敗しても null を返すだけ。 */
async function moodFor(
  trackId: string,
  track: TrackSummary,
  genres: string[]
): Promise<MoodResult | null> {
  const cached = await readThrough<MoodResult>(moodCache, trackId, `mood:${trackId}`);
  if (cached) return cached;

  try {
    const text = await generateMood({
      trackName: track.name,
      artistName: track.artist,
      albumName: track.album,
      genres,
      popularity: track.popularity,
    });
    const mood = { text, generated_at: new Date().toISOString() };
    await writeThrough(moodCache, trackId, `mood:${trackId}`, mood, MOOD_TTL_SECONDS);
    return mood;
  } catch (err) {
    // ムードが出せなくても曲情報は返す（デグレード動作）。
    // 原因が伝わればよいので、スタックトレースは出さない。
    console.error('[mood] ムード文を省略しました:', err instanceof Error ? err.message : err);
    return null;
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

  const mood =
    wantMood && data.isPlaying && data.track && data.trackId
      ? await moodFor(data.trackId, data.track, data.genres)
      : null;

  const response: NowPlayingResponse = {
    is_playing: data.isPlaying,
    track: data.track,
    mood,
    fetched_at: new Date().toISOString(),
  };

  if (!options.bypassCache) cacheSet(nowPlayingCache, 'now-playing', response);
  return response;
}

export interface RecentlyPlayed {
  track: TrackSummary;
  mood: MoodResult | null;
  /** 再生し終えた時刻（ISO 8601） */
  played_at: string;
}

/** 静的モードが前回までに確定させていた「最後に聴いた曲」。 */
export interface KnownRecent {
  trackId: string;
  mood: MoodResult | null;
  observedAt: string;
}

/**
 * 直近に再生し終えた曲。静的モード（CLI）専用で、ライブAPIには出さない。
 *
 * 前回の観測（previous）を更新すべきときだけ返し、それ以外は null を返す:
 * - 前回より後に聴き終えた曲がある
 * - 前回と同じ曲だが、前回は LLM が失敗してムード文が無い（作り直す）
 * 取得できない（スコープ不足の古い refresh_token など）ときも null で、例外にしない。
 * 判定を先にするのは、採用しない曲のために LLM を呼ばないため。
 */
export async function collectRecentlyPlayed(
  options: CollectOptions & { previous?: KnownRecent | null } = {}
): Promise<RecentlyPlayed | null> {
  let data;
  try {
    data = await fetchRecentlyPlayed();
  } catch (err) {
    console.warn(
      '[recently-played] 直近の再生履歴を取得できませんでした。前回の観測を引き継ぎます。' +
        '`npm run setup` で再認証すると取得できるようになります:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
  if (!data) return null;

  const wantMood = !options.skipMood && hasLlmConfigured();
  const previous = options.previous;
  const sameTrack = previous?.trackId === data.track.id;
  const newer = !previous || isLater(data.playedAt, previous.observedAt);
  const moodMissing = sameTrack && !previous?.mood && wantMood;
  if (!newer && !moodMissing) return null;

  let mood: MoodResult | null = null;
  if (sameTrack && previous?.mood) {
    mood = previous.mood;
  } else if (wantMood) {
    // 履歴からはジャンルを引かない（新しいアプリでは取れず、往復が増えるだけ）
    mood = await moodFor(data.track.id, data.track, []);
  }

  // 同じ曲を作り直しただけなら、時刻は前回のまま（新しい方を採る）
  const playedAt = newer || !previous ? data.playedAt : previous.observedAt;
  return { track: data.track, mood, played_at: playedAt };
}

function isLater(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return false;
  return Number.isNaN(tb) || ta > tb;
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
