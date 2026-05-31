import { Router } from 'express';
import { fetchTopTracks } from '../spotify/topTracks.js';
import { topTracksCache } from '../cache/index.js';
import type { TopTracksResponse } from '../types/index.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const cached = topTracksCache.get<TopTracksResponse>('top-tracks');
    if (cached) {
      res.sendFormatted(cached);
      return;
    }

    const tracks = await fetchTopTracks();
    const response: TopTracksResponse = {
      range: 'short_term',
      fetched_at: new Date().toISOString(),
      tracks,
    };

    topTracksCache.set('top-tracks', response);
    res.sendFormatted(response);
  } catch (err) {
    next(err);
  }
});

export default router;
