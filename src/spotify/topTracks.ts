import { spotifyFetch } from './client.js';
import type { SpotifyTrack, SpotifyArtist, TopTrackEntry } from '../types/index.js';

function pickAlbumArt(images: { url: string; width: number | null }[]): string {
  const large = images
    .filter((img) => img.width !== null && img.width >= 300)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (large[0] ?? images[0])?.url ?? '';
}

async function fetchArtistGenres(artistIds: string[]): Promise<Map<string, string[]>> {
  const genreMap = new Map<string, string[]>();
  if (artistIds.length === 0) return genreMap;

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

export async function fetchTopTracks(): Promise<TopTrackEntry[]> {
  const res = await spotifyFetch('/me/top/tracks?time_range=short_term&limit=50');
  if (!res) return [];

  const data = (await res.json()) as { items: SpotifyTrack[] };
  const tracks = data.items;

  const allArtistIds = Array.from(
    new Set(tracks.flatMap((t) => t.artists.map((a) => a.id)))
  );
  const genreMap = await fetchArtistGenres(allArtistIds);

  return tracks.map((track, index): TopTrackEntry => ({
    rank: index + 1,
    id: track.id,
    name: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    album: track.album.name,
    album_art_url: pickAlbumArt(track.album.images),
    duration_ms: track.duration_ms,
    popularity: track.popularity,
    genres: Array.from(new Set(track.artists.flatMap((a) => genreMap.get(a.id) ?? []))),
    spotify_url: track.external_urls.spotify,
    preview_url: track.preview_url,
  }));
}
