import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { buildAuthorizeUrl, exchangeCodeForTokens, type OAuthApp } from '../spotify/oauth.js';
import { escapeXml } from '../render/text.js';

const router = new Hono();

// CSRF対策の state はブラウザごとに Cookie で持つ。サーバーのグローバル変数に
// 置くと、別の人が /auth/login を開いた時点で上書きされ、取り違えが起きる。
const STATE_COOKIE = 'spotify_oauth_state';

// トークンを含む応答・それに至る応答はどこにもキャッシュさせない。
router.use(async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

function oauthApp(): OAuthApp {
  return {
    clientId: config.spotify.clientId,
    clientSecret: config.spotify.clientSecret,
    redirectUri: config.spotify.redirectUri,
  };
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

router.get('/login', (c) => {
  const state = randomBytes(16).toString('hex');
  setCookie(c, STATE_COOKIE, state, {
    path: '/auth',
    httpOnly: true,
    // Spotify からのトップレベル遷移で戻ってくるので Lax（Strict だと送られない）
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: 600,
  });
  return c.redirect(buildAuthorizeUrl(oauthApp(), state));
});

router.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/auth' });

  if (!state || !expected || !sameState(state, expected)) {
    return c.text('Invalid state parameter. Please restart the auth flow from /auth/login.', 400);
  }

  // 承認を拒否された（access_denied など）。state の検証を先に済ませてから見る。
  // 値はリクエスト由来なので text/plain で返し、HTML には埋めない。
  const error = c.req.query('error');
  if (error) {
    return c.text(`承認されませんでした (${error})。/auth/login からやり直してください。`, 400);
  }

  if (!code) {
    return c.text('Missing code parameter', 400);
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(oauthApp(), code);
  } catch (err) {
    // メッセージは oauth.ts / timeout.ts が組み立てた固定文で、Spotify の応答本文は含まない。
    // Redirect URI の登録漏れなど、ここで直すべき設定の誤りが最も起きやすい。
    const message = err instanceof Error ? err.message : 'トークンの交換に失敗しました。';
    console.error('[auth]', message);
    return c.text(`${message}\n/auth/login からやり直してください。`, 502);
  }

  // refresh_token はログに出さない（ログ収集基盤に残るため）。ブラウザにだけ表示する。
  console.log('\n✅ OAuth successful! ブラウザに表示された SPOTIFY_REFRESH_TOKEN を設定してください。');
  console.log('（`npm run setup` を使うと、この貼り付け作業は不要になります）\n');

  const nonce = randomBytes(16).toString('base64');
  c.header('Content-Security-Policy', tokenPageCsp(nonce));
  // 埋め込む値は escapeXml を通した refresh_token と nonce のみ(リクエスト由来の値は含まない)
  // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
  return c.html(renderTokenPage(tokens.refresh_token, nonce));
});

/**
 * トークンを表示するページの CSP。スクリプトはコピー用の1本だけを nonce で許し、
 * 外部への読み込み・送信・フレームへの埋め込みはすべて禁じる。
 */
function tokenPageCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** 画面共有やのぞき見で読まれないよう、表示は先頭と末尾だけにする。 */
function maskToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 4)}…${token.slice(-4)}` : '••••••••';
}

/**
 * refresh_token の表示ページ。既定では伏せて表示し、全文はコピー操作か
 * 「全文を表示」でだけ扱う。埋め込む値はすべて escapeXml を通す。
 */
function renderTokenPage(refreshToken: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>認証完了</title></head>
<body style="font-family:monospace;padding:2rem;max-width:48rem">
  <h2>✅ 認証完了</h2>
  <p><strong>この画面には秘密情報が含まれています。他人に見せず、設定を終えたら閉じてください。</strong></p>
  <p>次の値を設定ファイルに貼り付けてください:</p>
  <pre style="background:#f0f0f0;padding:1rem;border-radius:4px">SPOTIFY_REFRESH_TOKEN=${escapeXml(maskToken(refreshToken))}</pre>
  <p><button type="button" id="copy">SPOTIFY_REFRESH_TOKEN=… をコピー</button> <span id="status" role="status"></span></p>
  <details>
    <summary>全文を表示（コピーできないとき）</summary>
    <pre id="token" style="background:#f0f0f0;padding:1rem;border-radius:4px;white-space:pre-wrap;word-break:break-all">${escapeXml(refreshToken)}</pre>
  </details>
  <p>設定後、このサーバーを停止して <code>npm run dev</code> で再起動してください。</p>
  <p style="color:#666">次回からは <code>npm run setup</code> を使うと、この貼り付け作業なしで完了します。</p>
  <script nonce="${escapeXml(nonce)}">
    document.getElementById('copy').addEventListener('click', function () {
      var status = document.getElementById('status');
      var value = 'SPOTIFY_REFRESH_TOKEN=' + document.getElementById('token').textContent;
      navigator.clipboard.writeText(value).then(
        function () { status.textContent = 'コピーしました'; },
        function () { status.textContent = 'コピーできませんでした。「全文を表示」から手でコピーしてください。'; }
      );
    });
  </script>
</body></html>
`;
}

export default router;
