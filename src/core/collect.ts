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
import { generateMood, MOOD_PROMPT_VERSION } from '../llm/moodGenerator.js';
import { hasLlmConfigured, resolveLlm } from '../llm/settings.js';
import { sharesInFlightWork } from '../runtime.js';
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
  /**
   * ムード文の生成を待つ上限（ミリ秒）。間に合わなければ mood: null で返し、生成は続けてキャッシュに入れる
   * （次の取得で載る）。ムード文は任意の情報なので、遅い LLM のために曲情報まで遅らせない。
   * 省略すると最後まで待つ（静的モードの CLI）。
   */
  moodDeadlineMs?: number;
  /**
   * 応答の後に終わればよい処理（締め切りに間に合わなかった生成・外部ストアへの書き込み）を預ける先。
   * Workers では ctx.waitUntil。省略すると、書き込みは待ち、生成はそのまま走らせておく（Node）。
   */
  defer?: (work: Promise<unknown>) => void;
  /**
   * すでに分かっているムード文（静的モードの前回のスナップショット）。再生中の曲が同じなら LLM を呼ばずに使う。
   * CLI は実行ごとに新しいプロセスでメモリのキャッシュが空なので、これが無いと同じ曲でも毎回作り直す。
   */
  knownMood?: { trackId: string; mood: MoodResult } | null;
}

export interface TopTracksOptions {
  /** 集計期間。既定は short_term（直近4週間）。 */
  range?: TopTracksRange;
  /** 取得件数（10 / 30 / 50）。既定は 50。 */
  limit?: TopTracksLimit;
}

/** maxKeys 超過時に set が throw する。保存失敗は致命的ではない。 */
function cacheSet<V>(cache: TtlCache<V>, key: string, value: V): void {
  try {
    cache.set(key, value);
  } catch {
    // キャッシュが満杯。次回は再取得になるだけなので無視する。
  }
}

/** 外部ストアから読んだ値がムード文の形か（古い版が書いた値をそのまま使わない）。 */
function isMoodResult(value: unknown): value is MoodResult {
  if (!value || typeof value !== 'object') return false;
  const mood = value as Record<string, unknown>;
  return typeof mood['text'] === 'string' && typeof mood['generated_at'] === 'string';
}

/** 曲ごとのムード文の保持期間。メモリの moodCache と揃える。 */
const MOOD_TTL_SECONDS = 86400;

/**
 * メモリ → 外部ストアの順に引く。外部ストアで見つかればメモリにも載せる。
 * 外部ストアの障害は「見つからなかった」として扱う（生成し直すだけ）。
 */
async function readThrough<T>(
  cache: TtlCache<T>,
  key: string,
  durableKey: string,
  isValid: (value: unknown) => value is T
): Promise<T | null> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const store = getDurableStore();
  if (!store) return null;
  try {
    const stored = await store.get(durableKey);
    if (!isValid(stored)) return null;
    cacheSet(cache, key, stored);
    return stored;
  } catch (err) {
    console.warn('[store] 読み込みに失敗しました:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * メモリに載せ、外部ストアにも書く。外部ストアへの書き込みは応答の中身に影響しないので、
 * defer があれば預けて待たない（Workers の ctx.waitUntil）。失敗はどちらでもログに出すだけ。
 */
async function writeThrough<V>(
  cache: TtlCache<V>,
  key: string,
  durableKey: string,
  value: V,
  ttlSeconds: number | undefined,
  defer: CollectOptions['defer']
): Promise<void> {
  cacheSet(cache, key, value);
  const store = getDurableStore();
  if (!store) return;
  const written = (async () => {
    try {
      await store.put(durableKey, value, ttlSeconds);
    } catch (err) {
      console.warn('[store] 書き込みに失敗しました:', err instanceof Error ? err.message : err);
    }
  })();
  if (defer) defer(written);
  else await written;
}

/**
 * ムード文のキャッシュのキー。曲 ID だけにすると、モデルやプロンプトを変えても保存済みの文が使われ続けるので、
 * プロンプトの版とモデル名を含める。
 */
function moodKey(trackId: string): string {
  const llm = resolveLlm();
  const model = llm.kind === 'ready' ? llm.settings.model : '';
  return `v${MOOD_PROMPT_VERSION}:${model}:${trackId}`;
}

/**
 * 進行中のムード文の生成（キーごと）。同じ曲の生成を同時に2本走らせない。
 * Workers では別のリクエストが作った Promise を待てないので使わない（src/runtime.ts）。
 */
const moodInFlight = new Map<string, Promise<MoodResult | null>>();

/** 生成して保存する。失敗しても null を返すだけで、投げない。 */
async function generateAndStoreMood(
  key: string,
  track: TrackSummary,
  genres: string[],
  defer: CollectOptions['defer']
): Promise<MoodResult | null> {
  try {
    const text = await generateMood({
      trackName: track.name,
      artistName: track.artist,
      albumName: track.album,
      genres,
      popularity: track.popularity,
    });
    const mood = { text, generated_at: new Date().toISOString() };
    await writeThrough(moodCache, key, `mood:${key}`, mood, MOOD_TTL_SECONDS, defer);
    return mood;
  } catch (err) {
    // ムードが出せなくても曲情報は返す（デグレード動作）。
    // 原因が伝わればよいので、スタックトレースは出さない。
    console.error('[mood] ムード文を省略しました:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** 曲ごとのムード文。キャッシュに無ければ生成する。失敗・締め切り切れなら null。 */
async function moodFor(
  trackId: string,
  track: TrackSummary,
  genres: string[],
  options: Pick<CollectOptions, 'moodDeadlineMs' | 'defer'> = {}
): Promise<MoodResult | null> {
  const key = moodKey(trackId);
  const cached = await readThrough(moodCache, key, `mood:${key}`, isMoodResult);
  if (cached) return cached;

  let generation: Promise<MoodResult | null>;
  if (sharesInFlightWork()) {
    generation =
      moodInFlight.get(key) ??
      generateAndStoreMood(key, track, genres, options.defer).finally(() => {
        moodInFlight.delete(key);
      });
    moodInFlight.set(key, generation);
  } else {
    generation = generateAndStoreMood(key, track, genres, options.defer);
  }

  if (options.moodDeadlineMs === undefined) return generation;

  // 間に合わなくても生成は続ける（終われば moodCache に入り、次の取得で載る）。
  // Workers は応答を返すと残りの処理を止めるので、続きを預ける
  options.defer?.(generation);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), options.moodDeadlineMs);
  });
  try {
    return await Promise.race([generation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * キャッシュが切れた瞬間に来たリクエストは、進行中の取得を待って同じ結果を使う。
 * そうしないと同時アクセスの数だけ Spotify と LLM を並列に叩く。
 */
let nowPlayingInFlight: Promise<NowPlayingResponse> | null = null;

export async function collectNowPlaying(
  options: CollectOptions = {}
): Promise<NowPlayingResponse> {
  if (options.bypassCache) return fetchAndBuildNowPlaying(options);

  const cached = nowPlayingCache.get('now-playing');
  if (cached !== undefined) return cached;

  // skipMood の有無で結果が変わるので、共有するのは既定の呼び出しだけ。
  if (options.skipMood) return fetchAndBuildNowPlaying(options);
  // Workers では、別のリクエストが作った Promise を待たない（src/runtime.ts）。値のキャッシュだけを共有する
  if (!sharesInFlightWork()) return fetchAndBuildNowPlaying(options);
  nowPlayingInFlight ??= fetchAndBuildNowPlaying(options).finally(() => {
    nowPlayingInFlight = null;
  });
  return nowPlayingInFlight;
}

async function fetchAndBuildNowPlaying(options: CollectOptions): Promise<NowPlayingResponse> {
  const data = await fetchNowPlaying();

  // LLMが未設定なら、呼びに行かず静かに省く（曲情報だけで成立する）
  const wantMood = !options.skipMood && hasLlmConfigured();

  let mood: MoodResult | null = null;
  if (wantMood && data.isPlaying && data.track && data.trackId) {
    mood =
      options.knownMood?.trackId === data.trackId
        ? options.knownMood.mood
        : await moodFor(data.trackId, data.track, data.genres, options);
  }

  const response: NowPlayingResponse = {
    is_playing: data.isPlaying,
    track: data.track,
    mood,
    fetched_at: new Date().toISOString(),
  };

  // skipMood の結果はムード文を欠くので、共有のキャッシュに入れない（in-flight を共有しないのと同じ理由。
  // 入れると、続く既定の呼び出しが30秒間ムード文なしになる）
  if (!options.bypassCache && !options.skipMood) cacheSet(nowPlayingCache, 'now-playing', response);
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
  const previous = options.previous ?? null;
  const sameTrack = previous !== null && previous.trackId === data.track.id;
  const newer = previous === null || isLater(data.playedAt, previous.observedAt);
  const moodMissing = sameTrack && !previous.mood && wantMood;
  if (!newer && !moodMissing) return null;

  let mood: MoodResult | null = null;
  if (sameTrack && previous.mood) {
    mood = previous.mood;
  } else if (wantMood) {
    // 履歴からはジャンルを引かない（新しいアプリでは取れず、往復が増えるだけ）
    mood = await moodFor(data.track.id, data.track, []);
  }

  // 同じ曲を作り直しただけなら、時刻は前回のまま（新しい方を採る）
  const playedAt = newer ? data.playedAt : previous.observedAt;
  return { track: data.track, mood, played_at: playedAt };
}

/**
 * a が b より新しいか。a が読めなければ採らない（false）。b（前回の観測時刻）が読めなければ a を採る（true）。
 * readSnapshot() は読めない observed_at を捨てるので、通常 b は読める。
 */
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
