/**
 * 直近に再生し終えた曲（静的モード専用）。
 *
 * 静的モードは GitHub Actions の実行時点しか見ない。schedule は実測で
 * 数時間おきにしか走らないため、currently-playing だけだと「実行の瞬間に
 * たまたま再生中」でない限り新しい曲を拾えず、カードが何日も前の曲で
 * 固まる。停止中はこれで「最後に聴き終えた曲」を補う。
 *
 * `user-read-recently-played` スコープが必要。v1.3.0 より前に発行した
 * refresh_token には含まれないため、失敗しても例外にせず null を返し、
 * 呼び出し側は従来どおり前回のスナップショットを引き継ぐ。
 */
import { spotifyFetch } from './client.js';
import { isCatalogTrack, toTrackSummary } from './track.js';
import type { SpotifyTrack, TrackSummary } from '../types/index.js';

/**
 * 新しい順に何件まで見るか。先頭がローカルファイルでも、その前に聴いたカタログの曲を拾えるように
 * 1件より多く取る（Spotify は 1〜50 を受け付ける）。
 */
const HISTORY_LIMIT = 10;

interface RecentlyPlayedResponse {
  items: { track: SpotifyTrack; played_at: string }[];
}

export interface RecentlyPlayedData {
  track: TrackSummary;
  /** 再生し終えた時刻（ISO 8601） */
  playedAt: string;
}

export async function fetchRecentlyPlayed(): Promise<RecentlyPlayedData | null> {
  const res = await spotifyFetch(`/me/player/recently-played?limit=${HISTORY_LIMIT}`);
  if (!res) return null;

  const data = (await res.json()) as RecentlyPlayedResponse;
  // ローカルファイルやエピソードは id が無いことがある（now-playing と同じ判定）。
  // 新しい順に並んでいるので、最初のカタログの曲が「最後に聴いた曲」になる。
  for (const item of data.items ?? []) {
    if (item?.track && isCatalogTrack(item.track)) {
      return { track: toTrackSummary(item.track), playedAt: item.played_at };
    }
  }
  return null;
}
