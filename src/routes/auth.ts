import { Router } from 'express';
import { randomBytes } from 'crypto';
import { config } from '../config.js';

const router = Router();

const SCOPES = [
  'user-read-currently-playing',
  'user-top-read',
].join(' ');

// CSRF対策: stateをメモリに保持 (dev-onlyサーバーなので十分)
let pendingState: string | null = null;

router.get('/login', (_req, res) => {
  pendingState = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.spotify.clientId,
    scope: SCOPES,
    redirect_uri: config.spotify.redirectUri,
    state: pendingState,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

router.get('/callback', async (req, res) => {
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

  const credentials = Buffer.from(
    `${config.spotify.clientId}:${config.spotify.clientSecret}`
  ).toString('base64');

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.spotify.redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    res.status(500).send('Token exchange failed. Check your SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.');
    return;
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  console.log('\n✅ OAuth successful!');
  console.log('SPOTIFY_REFRESH_TOKEN=' + tokens.refresh_token);
  console.log('\nCopy the above line into your .env file, then restart with: npm run dev\n');

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
      <p>以下を <code>.env</code> ファイルにコピーしてください:</p>
      <pre style="background:#f0f0f0;padding:1rem;border-radius:4px">SPOTIFY_REFRESH_TOKEN=${escaped}</pre><!-- nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -->
      <p>コピー後、このサーバーを停止して <code>npm run dev</code> で再起動してください。</p>
    </body></html>
  `);
});

export default router;
