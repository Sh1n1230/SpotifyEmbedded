import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { buildAuthorizeUrl, exchangeCodeForTokens, type OAuthApp } from '../spotify/oauth.js';

const router = new Hono();

// CSRF対策: stateをメモリに保持 (dev-onlyサーバーなので十分)
let pendingState: string | null = null;

function oauthApp(): OAuthApp {
  return {
    clientId: config.spotify.clientId,
    clientSecret: config.spotify.clientSecret,
    redirectUri: config.spotify.redirectUri,
  };
}

router.get('/login', (c) => {
  pendingState = randomBytes(16).toString('hex');
  return c.redirect(buildAuthorizeUrl(oauthApp(), pendingState));
});

router.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!state || state !== pendingState) {
    return c.text('Invalid state parameter. Please restart the auth flow from /auth/login.', 400);
  }
  pendingState = null;

  if (!code) {
    return c.text('Missing code parameter', 400);
  }

  const tokens = await exchangeCodeForTokens(oauthApp(), code);

  console.log('\n✅ OAuth successful!');
  console.log('SPOTIFY_REFRESH_TOKEN=' + tokens.refresh_token);
  console.log('\n上記の行をコピーして設定してください。');
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
