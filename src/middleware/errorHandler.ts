import type { Request, Response, NextFunction } from 'express';
import { SpotifyApiError, SpotifyAuthError, SpotifyRateLimitError } from '../spotify/client.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof SpotifyAuthError) {
    res.status(502).json({ error: 'Spotify authentication failed. Re-run `npm run setup` to get a new refresh_token.' });
    return;
  }

  if (err instanceof SpotifyRateLimitError) {
    res.setHeader('Retry-After', String(err.retryAfter));
    res.status(429).json({ error: 'Spotify rate limit exceeded', retry_after: err.retryAfter });
    return;
  }

  // Spotify 由来の失敗は、こちらのバグではなく相手側の応答なので
  // 502 で返し、原因（403 など）をそのまま伝える。
  if (err instanceof SpotifyApiError) {
    console.error('[spotify]', err.message);
    res.status(502).json({ error: err.message, spotify_status: err.status });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
