/**
 * Authorization Code フローの共通部分。
 * ライブAPIの /auth ルートと CLI の setup の両方から使う。
 */

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

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** 認可コードを refresh_token に交換する。失敗時は理由を添えて throw。 */
export async function exchangeCodeForTokens(
  app: OAuthApp,
  code: string
): Promise<TokenResponse> {
  const credentials = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64');

  const res = await fetch('https://accounts.spotify.com/api/token', {
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
  });

  if (!res.ok) {
    const detail = res.status === 400
      ? 'Client ID / Client Secret、または Redirect URI の登録内容を確認してください。'
      : '';
    throw new Error(`トークンの交換に失敗しました (${res.status})。${detail}`);
  }

  return (await res.json()) as TokenResponse;
}
