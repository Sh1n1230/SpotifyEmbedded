import { spotifyFetch } from './client.js';
import { fetchArtistGenres } from './artists.js';
import type { SpotifyPlaybackState, TrackSummary } from '../types/index.js';

function pickAlbumArt(images: { url: string; width: number | null }[]): string {
  const large = images
    .filter((img) => img.width !== null && img.width >= 300)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (large[0] ?? images[0])?.url ?? '';
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

  if (!state.is_playing || !state.item) {
    return { isPlaying: false, track: null, genres: [], trackId: null };
  }

  const item = state.item;
  const artistIds = item.artists.map((a) => a.id);
  const genreMap = await fetchArtistGenres(artistIds);
  const genres = Array.from(new Set(artistIds.flatMap((id) => genreMap.get(id) ?? [])));

  const track: TrackSummary = {
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

  return { isPlaying: true, track, genres, trackId: item.id };
}
