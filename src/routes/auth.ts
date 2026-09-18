import { Router } from 'express';
import { randomBytes } from 'crypto';
import { config } from '../config.js';
import { buildAuthorizeUrl, exchangeCodeForTokens, type OAuthApp } from '../spotify/oauth.js';

const router = Router();

// CSRF対策: stateをメモリに保持 (dev-onlyサーバーなので十分)
let pendingState: string | null = null;

function oauthApp(): OAuthApp {
  return {
    clientId: config.spotify.clientId,
    clientSecret: config.spotify.clientSecret,
    redirectUri: config.spotify.redirectUri,
  };
}

router.get('/login', (_req, res) => {
  pendingState = randomBytes(16).toString('hex');
  res.redirect(buildAuthorizeUrl(oauthApp(), pendingState));
});

router.get('/callback', async (req, res, next) => {
  const code = req.query['code'] as string | undefined;
  const state = req.query['state'] as string | undefined;

  if (!state || state !== pendingState) {
    res.status(400).send('Invalid state parameter. Please restart the auth flow from /auth/login.');
    return;
  }
  pendingState = null;

  if (!code) {
    res.status(400).send('Missing code parameter');
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(oauthApp(), code);

    console.log('\n✅ OAuth successful!');
    console.log('SPOTIFY_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\n上記の行をコピーして設定してください。');
    console.log('（`npx spotify-embedded setup` を使うと、この貼り付け作業は不要になります）\n');

    // refresh_token はHTMLエスケープしてXSSを防ぐ
    const escaped = tokens.refresh_token.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c)
    );

    // 埋め込む値は上でエスケープ済みの refresh_token のみ(リクエスト由来の値は含まない)
    // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    res.send(`
      <!DOCTYPE html>
      <html lang="ja"><head><meta charset="utf-8"><title>認証完了</title></head>
      <body style="font-family:monospace;padding:2rem">
        <h2>✅ 認証完了</h2>
        <p>以下を設定ファイルにコピーしてください:</p>
        <pre style="background:#f0f0f0;padding:1rem;border-radius:4px">SPOTIFY_REFRESH_TOKEN=${escaped}</pre><!-- nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -->
        <p>コピー後、このサーバーを停止して <code>npm run dev</code> で再起動してください。</p>
        <p style="color:#666">次回からは <code>npx spotify-embedded setup</code> を使うと、この貼り付け作業なしで完了します。</p>
      </body></html>
    `);
  } catch (err) {
    next(err);
  }
});

export default router;
