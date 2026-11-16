import { readSpotifyJson, spotifyFetch } from './client.js';
import { fetchArtistGenres } from './artists.js';
import { isCatalogTrack, toTrackSummary } from './track.js';
import type { SpotifyPlaybackState, TrackSummary } from '../types/index.js';

export interface NowPlayingData {
  isPlaying: boolean;
  track: TrackSummary | null;
  genres: string[];
  trackId: string | null;
  /** 取得した時点の再生位置（ミリ秒）。再生していない・Spotify が返さないときは null */
  progressMs: number | null;
}

const NOW_PLAYING_PATH = '/me/player/currently-playing?additional_types=track';

export async function fetchNowPlaying(): Promise<NowPlayingData> {
  const res = await spotifyFetch(NOW_PLAYING_PATH);

  if (!res) {
    return { isPlaying: false, track: null, genres: [], trackId: null, progressMs: null };
  }

  const state = await readSpotifyJson<SpotifyPlaybackState>(res, NOW_PLAYING_PATH);

  // 本文の無い 200・202 は、再生していないのと同じ扱いにする。
  // ローカルファイルは再生していないのと同じ扱いにする（静的モードでは
  // 前回のスナップショットの曲が「最後に聴いた曲」として残る）
  if (!state?.is_playing || !state.item || !isCatalogTrack(state.item)) {
    return { isPlaying: false, track: null, genres: [], trackId: null, progressMs: null };
  }

  const item = state.item;
  const artistIds = item.artists.map((a) => a.id);
  const genreMap = await fetchArtistGenres(artistIds);
  const genres = Array.from(new Set(artistIds.flatMap((id) => genreMap.get(id) ?? [])));

  const track = toTrackSummary(item);

  const progressMs =
    typeof state.progress_ms === 'number' && Number.isFinite(state.progress_ms) && state.progress_ms >= 0
      ? Math.round(state.progress_ms)
      : null;

  return { isPlaying: true, track, genres, trackId: item.id, progressMs };
}
