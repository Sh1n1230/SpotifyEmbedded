/**
 * Authorization Code フローの共通部分。
 * ライブAPIの /auth ルートと CLI の setup の両方から使う。
 */
import { fetchWithTimeout, SPOTIFY_TIMEOUT_MS } from './timeout.js';

// user-read-recently-played は v1.3.0 で追加。それ以前に発行した refresh_token には
// 含まれないが、静的モードは「取れなければ従来どおり」で動くので再認証は任意。
export const SCOPES = [
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
] as const;

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthorizeUrl(app: OAuthApp, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: app.clientId,
    scope: SCOPES.join(' '),
    redirect_uri: app.redirectUri,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * トークンエンドポイントの失敗の `error`（RFC 6749 §5.2 の決まった語彙）ごとの、直す場所の案内。
 * 応答の本文は任意の文字列なので案内にもログにも使わないが、`error` はこの一覧と照合したものだけを使う
 * （`error_description` や一覧に無い値は使わない）。
 */
const TOKEN_ERROR_HELP: Record<string, string> = {
  invalid_client: 'Client ID / Client Secret が正しくありません。設定値を確認してください。',
  invalid_grant:
    '認可コードが期限切れ・使用済みか、Redirect URI が Spotify の Dashboard の登録値と一致していません。' +
    'Redirect URI を確かめて、認可からやり直してください。',
  invalid_request: 'リクエストのパラメータが受け付けられませんでした（このアプリの不具合の可能性があります）。',
  unauthorized_client: 'この Spotify アプリには Authorization Code フローが許可されていません。Dashboard のアプリの設定を確認してください。',
  unsupported_grant_type: 'grant_type が受け付けられませんでした（このアプリの不具合の可能性があります）。',
};

/** 失敗の応答から `error` を読む。一覧に無い値・JSON でない本文は null。 */
async function tokenErrorCode(res: Response): Promise<string | null> {
  try {
    const error = ((await res.json()) as { error?: unknown }).error;
    return typeof error === 'string' && Object.hasOwn(TOKEN_ERROR_HELP, error) ? error : null;
  } catch {
    return null;
  }
}

/** 認可コードを refresh_token に交換する。失敗時は理由を添えて throw。 */
export async function exchangeCodeForTokens(
  app: OAuthApp,
  code: string
): Promise<TokenResponse> {
  const credentials = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64');

  // 応答が無いと setup は5分のタイマーまで待ち、原因を「承認のタイムアウト」と取り違える
  const res = await fetchWithTimeout(
    TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: app.redirectUri,
      }),
    },
    SPOTIFY_TIMEOUT_MS,
    TOKEN_URL
  );

  if (!res.ok) {
    const error = await tokenErrorCode(res);
    const detail =
      (error && TOKEN_ERROR_HELP[error]) ??
      (res.status === 400 ? 'Client ID / Client Secret、または Redirect URI の登録内容を確認してください。' : '');
    throw new Error(`トークンの交換に失敗しました (${res.status}${error ? ` ${error}` : ''})。${detail}`);
  }

  let data: Partial<TokenResponse>;
  try {
    data = (await res.json()) as Partial<TokenResponse>;
  } catch {
    throw new Error('トークンの交換の応答を読めませんでした（JSON ではない応答）。時間をおいてもう一度試してください。');
  }
  // refresh_token が無いと、保存しても以降のトークン更新ができない（静的モードもライブAPIも動かない）
  if (typeof data.refresh_token !== 'string' || data.refresh_token === '') {
    throw new Error(
      'トークンの交換の応答に refresh_token がありませんでした。Spotify のアプリの設定（Redirect URI）を確かめて、もう一度試してください。'
    );
  }
  return data as TokenResponse;
}
