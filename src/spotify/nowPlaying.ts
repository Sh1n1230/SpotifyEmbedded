import { spotifyFetch } from './client.js';
import { fetchArtistGenres } from './artists.js';
import { isCatalogTrack, toTrackSummary } from './track.js';
import type { SpotifyPlaybackState, TrackSummary } from '../types/index.js';

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
