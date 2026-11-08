import { getAccessToken, SpotifyAuthError } from './auth.js';
import { fetchWithTimeout, readBodyText, SPOTIFY_TIMEOUT_MS } from './timeout.js';
import { discardBody } from '../http/body.js';

import { SpotifyApiError, SpotifyRateLimitError, parseRetryAfter } from './errors.js';

export { SpotifyAuthError } from './auth.js';
export { SpotifyNetworkError, SpotifyTimeoutError } from './timeout.js';
export {
  MAX_RETRY_AFTER_SECONDS,
  SpotifyApiError,
  SpotifyRateLimitError,
  parseRetryAfter,
} from './errors.js';

const BASE_URL = 'https://api.spotify.com/v1';

/**
 * spotifyFetch() の応答の本文を JSON として読む。本文が空なら null（202 や本文の無い 200 は
 * 「再生していない」などと同じに扱える）。JSON として読めなければ SpotifyApiError（502）、
 * 読み取りの途中の時間切れは SpotifyTimeoutError（504）にする。
 */
export async function readSpotifyJson<T>(res: Response, path: string): Promise<T | null> {
  const text = await readBodyText(res, path, SPOTIFY_TIMEOUT_MS);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SpotifyApiError(res.status, path, `JSON ではない応答: ${text}`);
  }
}

async function spotifyFetchOnce(path: string, token: string): Promise<Response> {
  return fetchWithTimeout(
    `${BASE_URL}${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
    SPOTIFY_TIMEOUT_MS,
    path
  );
}

export async function spotifyFetch(path: string): Promise<Response | null> {
  let token = await getAccessToken();
  let res = await spotifyFetchOnce(path, token);

  if (res.status === 401) {
    await discardBody(res);
    token = await getAccessToken(true, token);
    res = await spotifyFetchOnce(path, token);
    if (res.status === 401) {
      await discardBody(res);
      throw new SpotifyAuthError();
    }
  }

  if (res.status === 429) {
    await discardBody(res);
    throw new SpotifyRateLimitError(parseRetryAfter(res.headers.get('Retry-After')));
  }

  // 再生していない・デバイスが無い場合は 204（本文なし）
  if (res.status === 204) return null;

  // ここで弾かないと、呼び出し側が `data.items` を undefined として扱い
  // 原因の分からない TypeError になる。
  if (!res.ok) {
    throw new SpotifyApiError(res.status, path, await res.text().catch(() => ''));
  }

  return res;
}
