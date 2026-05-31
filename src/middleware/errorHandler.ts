import type { Request, Response, NextFunction } from 'express';
import { SpotifyAuthError, SpotifyRateLimitError } from '../spotify/client.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof SpotifyAuthError) {
    res.status(502).json({ error: 'Spotify authentication failed. Re-run npm run auth to get a new refresh_token.' });
    return;
  }

  if (err instanceof SpotifyRateLimitError) {
    res.setHeader('Retry-After', String(err.retryAfter));
    res.status(429).json({ error: 'Spotify rate limit exceeded', retry_after: err.retryAfter });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
