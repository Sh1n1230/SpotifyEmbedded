import { Router } from 'express';
import { fetchNowPlaying } from '../spotify/nowPlaying.js';
import { generateMood } from '../llm/moodGenerator.js';
import { nowPlayingCache, moodCache } from '../cache/index.js';
import type { NowPlayingResponse, MoodResult } from '../types/index.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const cached = nowPlayingCache.get<NowPlayingResponse>('now-playing');
    if (cached) {
      res.sendFormatted(cached);
      return;
    }

    const data = await fetchNowPlaying();

    let mood: MoodResult | null = null;
    if (data.isPlaying && data.track && data.trackId) {
      const cachedMood = moodCache.get<MoodResult>(data.trackId);
      if (cachedMood) {
        mood = cachedMood;
      } else {
        try {
          const text = await generateMood({
            trackName: data.track.name,
            artistName: data.track.artist,
            albumName: data.track.album,
            genres: data.genres,
            popularity: data.track.popularity,
          });
          mood = { text, generated_at: new Date().toISOString() };
          moodCache.set(data.trackId, mood);
        } catch (moodErr) {
          console.error('[mood] LLM error (degraded mode):', moodErr);
        }
      }
    }

    const response: NowPlayingResponse = {
      is_playing: data.isPlaying,
      track: data.track,
      mood,
      fetched_at: new Date().toISOString(),
    };

    nowPlayingCache.set('now-playing', response);
    res.sendFormatted(response);
  } catch (err) {
    next(err);
  }
});

export default router;
