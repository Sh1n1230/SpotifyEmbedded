import { config } from '../config.js';
import { authValueSource, saveStoredAuth } from '../authStore.js';
import { SpotifyApiError, SpotifyRateLimitError, parseRetryAfter } from './errors.js';
import { fetchWithTimeout, readBodyText, SPOTIFY_TIMEOUT_MS } from './timeout.js';
import { discardBody } from '../http/body.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
/** エラーメッセージとログに出す、トークンエンドポイントの短い名前 */
const TOKEN_PATH = '/api/token';

/** expires_in が無い・不正なときに使うアクセストークンの寿命（秒）。Spotify の既定は 3600。 */
const DEFAULT_EXPIRES_IN_SECONDS = 3600;
/** 期限の少し前に取り直す余裕（秒）。寿命が短いときは寿命の半分まで。 */
const EXPIRY_MARGIN_SECONDS = 60;

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
    // 429 は Spotify API と同じく Retry-After を伝える
    if (res.status === 429) {
      await discardBody(res);
      throw new SpotifyRateLimitError(parseRetryAfter(res.headers.get('Retry-After')));
    }
    const body = await readBodyText(res, TOKEN_PATH, SPOTIFY_TIMEOUT_MS);
    const failure = authFailureOf(res.status, body);
    if (failure) throw new SpotifyAuthError(failure);
    // 5xx などは設定の問題ではないので、認証エラーにはしない。SpotifyApiError にして 502 と、
    // 本文を切り詰めたログを Spotify API の失敗と共有する
    throw new SpotifyApiError(res.status, TOKEN_PATH, body);
  }

  const text = await readBodyText(res, TOKEN_PATH, SPOTIFY_TIMEOUT_MS);
  let data: { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new SpotifyApiError(res.status, TOKEN_PATH, `JSON ではない応答: ${text}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    throw new SpotifyApiError(res.status, TOKEN_PATH, '応答に access_token がありません');
  }
  /** refresh_token は返らないこともある。返らなければ今のものを使い続ける。 */
  if (typeof data.refresh_token === 'string' && data.refresh_token && data.refresh_token !== refreshToken) {
    adoptRotatedRefreshToken(data.refresh_token);
  }
  // expires_in が無い・不正だと期限が NaN になり、以降のすべての呼び出しで取り直してしまう
  const expiresIn =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? data.expires_in
      : DEFAULT_EXPIRES_IN_SECONDS;
  const margin = Math.min(EXPIRY_MARGIN_SECONDS, expiresIn / 2);
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (expiresIn - margin) * 1000,
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

/**
 * @param forceRefresh 401 を受けた後の取り直し
 * @param staleToken 401 を受けたトークン。別のリクエストがすでに取り直していれば、もう一度更新を送らない
 */
export async function getAccessToken(forceRefresh = false, staleToken?: string): Promise<string> {
  const replaced = staleToken !== undefined && tokenState?.accessToken !== staleToken;
  if ((!forceRefresh || replaced) && tokenState && Date.now() < tokenState.expiresAt) {
    return tokenState.accessToken;
  }
  // 401 を受けた後の取り直し（forceRefresh）も、進行中の更新があればそれを待つだけでよい
  refreshing ??= fetchAccessToken().finally(() => {
    refreshing = null;
  });
  tokenState = await refreshing;
  return tokenState.accessToken;
}
