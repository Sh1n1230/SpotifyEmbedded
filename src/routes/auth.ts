import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

const SCOPES = [
  'user-read-currently-playing',
  'user-top-read',
].join(' ');

router.get('/login', (_req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.spotify.clientId,
    scope: SCOPES,
    redirect_uri: config.spotify.redirectUri,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

router.get('/callback', async (req, res) => {
  const code = req.query['code'] as string | undefined;
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
    const body = await tokenRes.text();
    res.status(500).send(`Token exchange failed: ${body}`);
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

  res.send(`
    <html><body style="font-family:monospace;padding:2rem">
      <h2>✅ OAuth successful!</h2>
      <p>Copy this into your <code>.env</code> file:</p>
      <pre style="background:#f0f0f0;padding:1rem;border-radius:4px">SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}</pre>
      <p>Then stop this server and run: <code>npm run dev</code></p>
    </body></html>
  `);
});

export default router;
