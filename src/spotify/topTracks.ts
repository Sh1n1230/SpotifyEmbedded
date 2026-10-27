import { spotifyFetch } from './client.js';
import { fetchArtistGenres } from './artists.js';
import { isCatalogTrack, toTrackSummary } from './track.js';
import {
  DEFAULT_TOP_TRACKS_RANGE,
  DEFAULT_TOP_TRACKS_LIMIT,
  type SpotifyTrack,
  type TopTrackEntry,
  type TopTracksRange,
  type TopTracksLimit,
} from '../types/index.js';

/**
 * 期間と件数を指定してトップトラックを取得する。
 * 期間は Spotify が用意する3つのプリセットのみ（任意の月数は指定できない）。
 */
export async function fetchTopTracks(
  range: TopTracksRange = DEFAULT_TOP_TRACKS_RANGE,
  limit: TopTracksLimit = DEFAULT_TOP_TRACKS_LIMIT
): Promise<TopTrackEntry[]> {
  const res = await spotifyFetch(`/me/top/tracks?time_range=${range}&limit=${limit}`);
  if (!res) return [];

  const data = (await res.json()) as { items?: SpotifyTrack[] };
  // トップトラックにローカルファイルは入らないが、公開スキーマ（id は文字列）を守るため通す
  const tracks = Array.isArray(data.items) ? data.items.filter(isCatalogTrack) : [];

  const allArtistIds = Array.from(
    new Set(tracks.flatMap((t) => t.artists.map((a) => a.id)))
  );
  const genreMap = await fetchArtistGenres(allArtistIds);

  return tracks.map((track, index): TopTrackEntry => {
    // top-tracks.json のキーの順番（genres は popularity の後）を変えないよう組み直す
    const { spotify_url, preview_url, ...head } = toTrackSummary(track);
    return {
      rank: index + 1,
      ...head,
      genres: Array.from(new Set(track.artists.flatMap((a) => genreMap.get(a.id) ?? []))),
      spotify_url,
      preview_url,
    };
  });
}
