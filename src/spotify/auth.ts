import { config } from '../config.js';

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

let tokenState: TokenState | null = null;

async function fetchAccessToken(): Promise<TokenState> {
  const credentials = Buffer.from(
    `${config.spotify.clientId}:${config.spotify.clientSecret}`
  ).toString('base64');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.spotify.refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenState && Date.now() < tokenState.expiresAt) {
    return tokenState.accessToken;
  }
  tokenState = await fetchAccessToken();
  return tokenState.accessToken;
}
