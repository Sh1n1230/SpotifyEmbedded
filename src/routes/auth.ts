import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { buildAuthorizeUrl, exchangeCodeForTokens, type OAuthApp } from '../spotify/oauth.js';

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

  if (!code) {
    return c.text('Missing code parameter', 400);
  }

  const tokens = await exchangeCodeForTokens(oauthApp(), code);

  // refresh_token はログに出さない（ログ収集基盤に残るため）。ブラウザにだけ表示する。
  console.log('\n✅ OAuth successful! ブラウザに表示された SPOTIFY_REFRESH_TOKEN を設定してください。');
  console.log('（`npm run setup` を使うと、この貼り付け作業は不要になります）\n');

  // refresh_token はHTMLエスケープしてXSSを防ぐ
  const escaped = tokens.refresh_token.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch
  );

  // 埋め込む値は上でエスケープ済みの refresh_token のみ(リクエスト由来の値は含まない)
  // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
  return c.html(`
      <!DOCTYPE html>
      <html lang="ja"><head><meta charset="utf-8"><title>認証完了</title></head>
      <body style="font-family:monospace;padding:2rem">
        <h2>✅ 認証完了</h2>
        <p>以下を設定ファイルにコピーしてください:</p>
        <pre style="background:#f0f0f0;padding:1rem;border-radius:4px">SPOTIFY_REFRESH_TOKEN=${escaped}</pre><!-- nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -->
        <p>コピー後、このサーバーを停止して <code>npm run dev</code> で再起動してください。</p>
        <p style="color:#666">次回からは <code>npm run setup</code> を使うと、この貼り付け作業なしで完了します。</p>
      </body></html>
    `);
});

export default router;
