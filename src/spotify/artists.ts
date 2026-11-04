/**
 * アーティストのジャンルタグ取得。
 *
 * 2024年11月以降に作成されたSpotifyアプリでは、`/artists?ids=` のバッチ
 * 取得が 403 を返し、単体の `/artists/{id}` も `genres` / `popularity` を
 * 含まなくなった（audio-features の廃止と同じ流れの制限）。
 *
 * つまり多くの環境ではジャンルは取得できない。しかし extended quota mode の
 * アプリでは今も返るため、機能自体は残しつつ「一度 403 を見たらそのプロセス
 * では二度と呼ばない」ようにしている。毎リクエストごとに失敗する呼び出しを
 * 投げ続けると、ムード文にも使えないまま往復が増えるだけになる。
 */
import { readSpotifyJson, spotifyFetch, SpotifyApiError } from './client.js';
import type { SpotifyArtist } from '../types/index.js';

/** 403 を一度見たら以降スキップする。プロセス単位で持てば十分。 */
let unavailable = false;

/** テスト・CLIの単発実行向け。状態を戻す。 */
export function resetArtistGenreAvailability(): void {
  unavailable = false;
}

/** ジャンルが取得できる環境か（一度 403 を見たら false）。 */
export function artistGenresAvailable(): boolean {
  return !unavailable;
}

/**
 * artistId → genres の対応を返す。
 * 取得できない環境では空の Map を返す（呼び出し側はジャンル無しで続行する）。
 */
export async function fetchArtistGenres(artistIds: string[]): Promise<Map<string, string[]>> {
  const genreMap = new Map<string, string[]>();
  // ローカルファイル由来のアーティストは id が空（null）で返る。空の要素を
  // 入れると `ids=,abc` になって 400 になるので、送る前に外す。
  const validIds = artistIds.filter((id) => typeof id === 'string' && id !== '');
  if (unavailable || validIds.length === 0) return genreMap;

  // Spotify のバッチ上限は 50 件
  for (let i = 0; i < validIds.length; i += 50) {
    const ids = validIds.slice(i, i + 50).join(',');

    const path = `/artists?ids=${ids}`;
    let data: { artists?: (SpotifyArtist | null)[] } | null;
    try {
      const res = await spotifyFetch(path);
      if (!res) continue;
      // 本文の読み取りの失敗（JSON でない・途中の時間切れ）も、ほかの一時的な失敗と同じく扱う
      data = await readSpotifyJson<{ artists?: (SpotifyArtist | null)[] }>(res, path);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // 「この環境では取れない」と言えるのは 403 だけ。タイムアウト・429・5xx は一時的な
      // 失敗なので、今回はジャンル無しで続け、次の呼び出しでまた試す。
      if (err instanceof SpotifyApiError && err.status === 403) markUnavailable(reason);
      else console.warn(`[spotify] ジャンルタグを取得できませんでした（次回また試します）: ${reason}`);
      return genreMap;
    }
    if (!Array.isArray(data?.artists)) {
      markUnavailable('応答に artists 配列が含まれていません');
      return genreMap;
    }

    for (const artist of data.artists) {
      if (artist && Array.isArray(artist.genres)) genreMap.set(artist.id, artist.genres);
    }
  }

  // 呼べたのに genres が一つも無い場合も、この環境では返らないと判断する
  if (genreMap.size === 0) {
    markUnavailable('このSpotifyアプリでは genres が返りません');
  }

  return genreMap;
}

function markUnavailable(reason: string): void {
  // now-playing と top-tracks は並行に走るので、同時に 403 を踏むことがある。
  // 案内は一度だけでよい。
  if (unavailable) return;
  unavailable = true;
  console.warn(
    `[spotify] ジャンルタグを取得できないため、以降は省略します: ${reason}\n` +
      '          （2024年11月以降に作成されたアプリでは Spotify 側の制限で取得できません）'
  );
}
