import { getAccessToken } from './auth.js';

const BASE_URL = 'https://api.spotify.com/v1';

export class SpotifyAuthError extends Error {
  constructor() {
    super('Spotify authentication failed');
    this.name = 'SpotifyAuthError';
  }
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

  if (res.status === 204) return null;

  return res;
}
