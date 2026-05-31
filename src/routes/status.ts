import { Router } from 'express';
import { fetchNowPlaying } from '../spotify/nowPlaying.js';
import { fetchTopTracks } from '../spotify/topTracks.js';
import { generateMood } from '../llm/moodGenerator.js';
import { nowPlayingCache, topTracksCache, moodCache } from '../cache/index.js';
import type { StatusResponse, NowPlayingResponse, TopTracksResponse, MoodResult } from '../types/index.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [nowPlayingData, topTracksData] = await Promise.all([
      (async (): Promise<NowPlayingResponse> => {
        const cached = nowPlayingCache.get<NowPlayingResponse>('now-playing');
        if (cached) return cached;

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
            } catch {
              // degraded mode: mood stays null
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
        return response;
      })(),

      (async (): Promise<TopTracksResponse> => {
        const cached = topTracksCache.get<TopTracksResponse>('top-tracks');
        if (cached) return cached;

        const tracks = await fetchTopTracks();
        const response: TopTracksResponse = {
          range: 'short_term',
          fetched_at: new Date().toISOString(),
          tracks,
        };
        topTracksCache.set('top-tracks', response);
        return response;
      })(),
    ]);

    const response: StatusResponse = {
      now_playing: nowPlayingData,
      top_tracks: topTracksData,
      generated_at: new Date().toISOString(),
    };

    res.sendFormatted(response);
  } catch (err) {
    next(err);
  }
});

export default router;
