import { spotifyFetch } from './client.js';
import type { SpotifyPlaybackState, SpotifyArtist, TrackSummary } from '../types/index.js';

function pickAlbumArt(images: { url: string; width: number | null }[]): string {
  const large = images
    .filter((img) => img.width !== null && img.width >= 300)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (large[0] ?? images[0])?.url ?? '';
}

async function fetchArtistGenres(artistIds: string[]): Promise<Map<string, string[]>> {
  const genreMap = new Map<string, string[]>();
  if (artistIds.length === 0) return genreMap;

  // Batch up to 50 ids per request (Spotify limit)
  for (let i = 0; i < artistIds.length; i += 50) {
    const ids = artistIds.slice(i, i + 50).join(',');
    const res = await spotifyFetch(`/artists?ids=${ids}`);
    if (!res) continue;
    const data = (await res.json()) as { artists?: SpotifyArtist[] };
    if (!Array.isArray(data.artists)) continue;
    for (const artist of data.artists) {
      if (artist) genreMap.set(artist.id, artist.genres);
    }
  }
  return genreMap;
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
    popularity: item.popularity,
    spotify_url: item.external_urls.spotify,
    preview_url: item.preview_url,
  };

  return { isPlaying: true, track, genres, trackId: item.id };
}
