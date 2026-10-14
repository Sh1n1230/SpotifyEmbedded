import { spotifyFetch } from './client.js';
import { fetchArtistGenres } from './artists.js';
import type { SpotifyPlaybackState, SpotifyTrack, TrackSummary } from '../types/index.js';

function pickAlbumArt(images: { url: string; width: number | null }[]): string {
  const large = images
    .filter((img) => img.width !== null && img.width >= 300)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (large[0] ?? images[0])?.url ?? '';
}

/**
 * Spotify のカタログにある曲か。
 *
 * ローカルファイル（`is_local: true`）は `id`・`external_urls`・アーティストの `id` が
 * すべて空で返る。公開スキーマ（`id` と `spotify_url` は文字列）を満たせず、
 * ジャンルも引けないので、now-playing でも recently-played でも採らない。
 * https://developer.spotify.com/documentation/web-api/concepts/playlists#local-files
 */
export function isCatalogTrack(item: SpotifyTrack): boolean {
  return item.is_local !== true && typeof item.id === 'string' && item.id !== '';
}

/** Spotify の生のトラックを、公開スキーマの形に揃える。recently-played とも共有する。 */
export function toTrackSummary(item: SpotifyTrack): TrackSummary {
  return {
    id: item.id,
    name: item.name,
    artist: item.artists.map((a) => a.name).join(', '),
    album: item.album.name,
    album_art_url: pickAlbumArt(item.album.images),
    duration_ms: item.duration_ms,
    // popularity は 2024年11月以降のアプリでは返らない。欠けていても
    // キー自体はスキーマに残す（利用側の分岐を増やさないため）。
    popularity: item.popularity ?? null,
    spotify_url: item.external_urls.spotify,
    preview_url: item.preview_url ?? null,
  };
}

export interface NowPlayingData {
  isPlaying: boolean;
  track: TrackSummary | null;
  genres: string[];
  trackId: string | null;
}

export async function fetchNowPlaying(): Promise<NowPlayingData> {
  const res = await spotifyFetch('/me/player/currently-playing?additional_types=track');

  if (!res) {
    return { isPlaying: false, track: null, genres: [], trackId: null };
  }

  const state = (await res.json()) as SpotifyPlaybackState;

  // ローカルファイルは再生していないのと同じ扱いにする（静的モードでは
  // 前回のスナップショットの曲が「最後に聴いた曲」として残る）
  if (!state.is_playing || !state.item || !isCatalogTrack(state.item)) {
    return { isPlaying: false, track: null, genres: [], trackId: null };
  }

  const item = state.item;
  const artistIds = item.artists.map((a) => a.id);
  const genreMap = await fetchArtistGenres(artistIds);
  const genres = Array.from(new Set(artistIds.flatMap((id) => genreMap.get(id) ?? [])));

  const track = toTrackSummary(item);

  return { isPlaying: true, track, genres, trackId: item.id };
}
