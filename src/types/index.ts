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

export interface SpotifyArtist extends SpotifyArtistRef {
  genres: string[];
  popularity: number;
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
  popularity: number;
  explicit: boolean;
  external_urls: { spotify: string };
  preview_url: string | null;
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
 * popularity: number     # 0–100
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
  popularity: number;
  spotify_url: string;
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
 * popularity: number
 * genres: string[]
 * spotify_url: string
 * preview_url: string | null
 */
export interface TopTrackEntry extends TrackSummary {
  rank: number;
  genres: string[];
}

/**
 * YAML schema for /api/top-tracks:
 *
 * range: "short_term"
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
  range: 'short_term';
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
 *   range: "short_term"
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
