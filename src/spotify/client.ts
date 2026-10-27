import { getAccessToken, SpotifyAuthError } from './auth.js';
import { fetchWithTimeout, SPOTIFY_TIMEOUT_MS } from './timeout.js';
import { discardBody } from '../http/body.js';

export { SpotifyAuthError } from './auth.js';
export { SpotifyTimeoutError } from './timeout.js';

const BASE_URL = 'https://api.spotify.com/v1';

/** 401 / 429 以外の失敗。原因が分かるメッセージを添える。 */
export class SpotifyApiError extends Error {
  status: number;
  path: string;
  constructor(status: number, path: string, body: string) {
    super(describe(status, path, body));
    this.name = 'SpotifyApiError';
    this.status = status;
    this.path = path;
  }
}

function describe(status: number, rawPath: string, body: string): string {
  // `/artists?ids=...` は50件分のIDが並ぶ。ログに全部出しても読めないので畳む。
  const path = rawPath.length > 80 ? `${rawPath.slice(0, 80)}…` : rawPath;
  const detail = body.trim() ? ` ${body.trim().slice(0, 200)}` : '';
  if (status === 403) {
    return (
      `Spotify が ${path} を拒否しました (403)。` +
      'アプリに必要なスコープが無いか、2024年11月以降に作成されたアプリで' +
      `制限されているエンドポイントです。${detail}`
    );
  }
  if (status === 404) return `Spotify のエンドポイントが見つかりません: ${path} (404).${detail}`;
  return `Spotify API の呼び出しに失敗しました: ${path} (${status}).${detail}`;
}

export class SpotifyRateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super('Spotify rate limit exceeded');
    this.name = 'SpotifyRateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * 429 の Retry-After を秒に直す。形式は秒数か HTTP-date（RFC 9110 §10.2.3）。
 * 読めない値・ヘッダー無しは 1 秒（Retry-After: NaN のような不正な値を利用者に渡さない）。
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  const raw = value?.trim() ?? '';
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - now) / 1000));
  return 1;
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
    token = await getAccessToken(true);
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
