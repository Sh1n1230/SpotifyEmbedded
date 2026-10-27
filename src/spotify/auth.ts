import { config } from '../config.js';
import { authValueSource, saveStoredAuth } from '../authStore.js';
import { fetchWithTimeout, SPOTIFY_TIMEOUT_MS } from './timeout.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

let tokenState: TokenState | null = null;

/** 進行中のトークン更新。同時に来た呼び出しはこれを待つ（更新を並列に送らない）。 */
let refreshing: Promise<TokenState> | null = null;

/**
 * 更新の応答で Spotify が新しい refresh_token を返したときの値。プロセスの中では
 * 以降これを使う（古い方が失効していても止まらないように）。
 */
let rotatedRefreshToken: string | null = null;

/** テスト・CLI の単発実行向け。アクセストークンと進行中の更新を捨てる。 */
export function resetAccessToken(): void {
  tokenState = null;
  refreshing = null;
  rotatedRefreshToken = null;
}

/**
 * 認証の失敗。設定（refresh_token や Client ID / Secret）を直さない限り回復しない。
 *
 * - `invalid_grant`: refresh_token が失効・取り消し済み（連携解除、Secret の再発行など）
 * - `invalid_client`: Client ID / Client Secret が違う
 * - `unauthorized`: トークンを取り直しても Spotify API が 401 を返す
 *
 * client.ts が import する側なので、循環しないようここで定義して client.ts から再 export する。
 */
export type SpotifyAuthFailure = 'invalid_grant' | 'invalid_client' | 'unauthorized';

export class SpotifyAuthError extends Error {
  reason: SpotifyAuthFailure;
  constructor(reason: SpotifyAuthFailure = 'unauthorized') {
    super(describeAuthFailure(reason));
    this.name = 'SpotifyAuthError';
    this.reason = reason;
  }
}

function describeAuthFailure(reason: SpotifyAuthFailure): string {
  switch (reason) {
    case 'invalid_grant':
      return 'Spotify の refresh_token が無効です（invalid_grant）。`npm run setup` で取り直してください。';
    case 'invalid_client':
      return 'Spotify の Client ID / Client Secret が正しくありません（invalid_client）。設定を確認してください。';
    default:
      return 'Spotify authentication failed';
  }
}

/**
 * トークンエンドポイントの失敗のうち、設定の問題によるものを見分ける。
 * 応答は RFC 6749 5.2 の形（`{"error":"invalid_grant", ...}`）。
 */
function authFailureOf(status: number, body: string): SpotifyAuthFailure | null {
  if (status !== 400 && status !== 401) return null;
  let error: unknown;
  try {
    error = (JSON.parse(body) as { error?: unknown }).error;
  } catch {
    return null;
  }
  return error === 'invalid_grant' || error === 'invalid_client' ? error : null;
}

async function fetchAccessToken(): Promise<TokenState> {
  const refreshToken = rotatedRefreshToken ?? config.spotify.refreshToken;
  const credentials = Buffer.from(
    `${config.spotify.clientId}:${config.spotify.clientSecret}`
  ).toString('base64');

  const res = await fetchWithTimeout(
    TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    },
    SPOTIFY_TIMEOUT_MS,
    TOKEN_URL
  );

  if (!res.ok) {
    const body = await res.text();
    const failure = authFailureOf(res.status, body);
    if (failure) throw new SpotifyAuthError(failure);
    // 5xx などは設定の問題ではないので、認証エラーにはしない
    throw new Error(`Spotify token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    /** 返らないこともある。返らなければ今のものを使い続ける。 */
    refresh_token?: string;
  };
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    adoptRotatedRefreshToken(data.refresh_token);
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

/**
 * Spotify が refresh_token を入れ替えてきた。古い方がいずれ失効すると、ある日突然
 * invalid_grant で止まるので、保存先に応じて引き継ぐ。
 * https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
 *
 * - data/auth.json から読んでいる: そこへ書き戻す（npm run setup と同じ保存先）
 * - 環境変数から読んでいる: こちらからは書き換えられないので、更新が必要だと知らせる。
 *   値はログに出さない
 */
function adoptRotatedRefreshToken(token: string): void {
  rotatedRefreshToken = token;
  if (authValueSource('spotifyRefreshToken') === 'file') {
    try {
      saveStoredAuth({ spotifyRefreshToken: token });
      console.warn('[spotify] 新しい refresh_token が発行されたため、data/auth.json を更新しました。');
      return;
    } catch (err) {
      console.warn('[spotify] 新しい refresh_token を保存できませんでした:', err instanceof Error ? err.message : err);
    }
  }
  console.warn(
    '[spotify] Spotify が新しい refresh_token を発行しました。このプロセスでは新しい方を使いますが、' +
      '登録している SPOTIFY_REFRESH_TOKEN（GitHub Secrets・wrangler secret など）は古いままです。' +
      '`npm run setup` で取り直して登録し直してください。'
  );
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenState && Date.now() < tokenState.expiresAt) {
    return tokenState.accessToken;
  }
  // 401 を受けた後の取り直し（forceRefresh）も、進行中の更新があればそれを待つだけでよい
  refreshing ??= fetchAccessToken().finally(() => {
    refreshing = null;
  });
  tokenState = await refreshing;
  return tokenState.accessToken;
}
