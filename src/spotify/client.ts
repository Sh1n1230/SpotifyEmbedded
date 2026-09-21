import { getAccessToken } from './auth.js';

const BASE_URL = 'https://api.spotify.com/v1';

export class SpotifyAuthError extends Error {
  constructor() {
    super('Spotify authentication failed');
    this.name = 'SpotifyAuthError';
  }
}

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

async function spotifyFetchOnce(path: string, token: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function spotifyFetch(path: string): Promise<Response | null> {
  let token = await getAccessToken();
  let res = await spotifyFetchOnce(path, token);

  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await spotifyFetchOnce(path, token);
    if (res.status === 401) throw new SpotifyAuthError();
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
    throw new SpotifyRateLimitError(retryAfter);
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
