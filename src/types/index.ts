/**
 * Canonical type definitions for SpotifyEmbedded.
 * These interfaces double as the YAML schema — the JSDoc comments
 * describe the shape consumers will see in API responses.
 */

// ── Spotify internal shapes ───────────────────────────────────────────────────

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyArtistRef {
  id: string;
  name: string;
  external_urls: { spotify: string };
}

/**
 * `/artists` の応答。2024年11月以降に作成されたアプリでは `genres` /
 * `popularity` が省略されるため、いずれも optional。
 */
export interface SpotifyArtist extends SpotifyArtistRef {
  genres?: string[];
  popularity?: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtistRef[];
  album: {
    name: string;
    images: SpotifyImage[];
    release_date: string;
  };
  duration_ms: number;
  /** 2024年11月以降に作成されたアプリでは返らない。 */
  popularity?: number;
  explicit: boolean;
  external_urls: { spotify: string };
  /** 同上。30秒プレビューも新しいアプリでは配信されない。 */
  preview_url?: string | null;
}

export interface SpotifyPlaybackState {
  is_playing: boolean;
  progress_ms: number;
  item: SpotifyTrack;
  timestamp: number;
}

// ── API response shapes (= YAML schema) ──────────────────────────────────────

/**
 * YAML schema for a track entry:
 *
 * id: string
 * name: string           # 曲名
 * artist: string         # カンマ区切り (例: "Artist A, Artist B")
 * album: string
 * album_art_url: string  # ジャケ写URL (300px以上の最大サイズ)
 * duration_ms: number
 * popularity: number | null   # 0–100。Spotifyが返さない場合は null
 * spotify_url: string
 * preview_url: string | null
 */
export interface TrackSummary {
  id: string;
  name: string;
  artist: string;
  album: string;
  album_art_url: string;
  duration_ms: number;
  /**
   * 0–100。2024年11月以降に作成されたSpotifyアプリでは API が返さないため
   * null になる。キー自体は常に存在させ、利用側の分岐を増やさない。
   */
  popularity: number | null;
  spotify_url: string;
  /** 30秒プレビュー。新しいアプリでは常に null。 */
  preview_url: string | null;
}

/**
 * YAML schema for mood:
 *
 * text: string           # 日本語ムード文 (例: "今ノリノリなようです")
 * generated_at: string   # ISO 8601
 */
export interface MoodResult {
  text: string;
  generated_at: string;
}

/**
 * YAML schema for /api/now-playing:
 *
 * is_playing: boolean
 * track:
 *   id: string
 *   name: string
 *   artist: string
 *   album: string
 *   album_art_url: string
 *   duration_ms: number
 *   popularity: number
 *   spotify_url: string
 *   preview_url: string | null
 * mood:
 *   text: string
 *   generated_at: string
 * fetched_at: string
 */
export interface NowPlayingResponse {
  is_playing: boolean;
  track: TrackSummary | null;
  mood: MoodResult | null;
  fetched_at: string;
}

// ── Top tracks の選択肢 ───────────────────────────────────────────────────────

/**
 * Spotify の `/me/top/*` が受け付ける集計期間。任意の月数は指定できず、
 * この3つから選ぶ（Spotify Web API の仕様）。
 *
 * short_term  ≒ 直近4週間
 * medium_term ≒ 直近6か月
 * long_term   ≒ 直近1年（ほぼ全期間）
 */
export const TOP_TRACKS_RANGES = ['short_term', 'medium_term', 'long_term'] as const;
export type TopTracksRange = (typeof TOP_TRACKS_RANGES)[number];

/**
 * 取得件数。Spotify 側は 1〜50 の任意値を許すが、キャッシュのキーが
 * 無限に増えるのを避けるため3段階に固定する。
 */
export const TOP_TRACKS_LIMITS = [10, 30, 50] as const;
export type TopTracksLimit = (typeof TOP_TRACKS_LIMITS)[number];

export const DEFAULT_TOP_TRACKS_RANGE: TopTracksRange = 'short_term';
export const DEFAULT_TOP_TRACKS_LIMIT: TopTracksLimit = 50;

/** ランキングSVG / HTMLの表示件数の上限。取得件数の最大値と揃える。 */
export const MAX_RANKING_COUNT = 50;
export const DEFAULT_RANKING_COUNT = 5;

/**
 * YAML schema for a top-track entry:
 *
 * rank: number
 * id: string
 * name: string
 * artist: string
 * album: string
 * album_art_url: string
 * duration_ms: number
 * popularity: number | null
 * genres: string[]          # アプリの権限で取得できない場合は空配列
 * spotify_url: string
 * preview_url: string | null
 */
export interface TopTrackEntry extends TrackSummary {
  rank: number;
  /**
   * アーティストのジャンルタグ。2024年11月以降に作成されたアプリでは
   * Spotify が返さないため空配列になる。
   */
  genres: string[];
}

/**
 * YAML schema for /api/top-tracks:
 *
 * range: "short_term" | "medium_term" | "long_term"
 * limit: 10 | 30 | 50     # リクエストした取得件数（実際の件数は tracks.length）
 * fetched_at: string
 * tracks:
 *   - rank: number
 *     name: string
 *     artist: string
 *     album_art_url: string
 *     genres: string[]
 *     ...
 */
export interface TopTracksResponse {
  range: TopTracksRange;
  limit: TopTracksLimit;
  fetched_at: string;
  tracks: TopTrackEntry[];
}

/**
 * YAML schema for /api/status:
 *
 * now_playing:
 *   is_playing: boolean
 *   track: ...
 *   mood: ...
 *   fetched_at: string
 * top_tracks:
 *   range: "short_term" | "medium_term" | "long_term"
 *   limit: 10 | 30 | 50
 *   fetched_at: string
 *   tracks: [...]
 * generated_at: string
 */
export interface StatusResponse {
  now_playing: NowPlayingResponse;
  top_tracks: TopTracksResponse;
  generated_at: string;
}

export type ResponseFormat = 'json' | 'yaml';
