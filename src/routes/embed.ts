/**
 * 埋め込み用のエンドポイント（ライブAPIモード）。
 *
 *   GET /embed        iframe 用HTMLページ
 *   GET /badge.svg    now-playing カードのSVG（GitHub README にも貼れる）
 *   GET /ranking.svg  ランキングのSVG
 *
 * SVG は静的モードと同じレンダラを使う。違いは「リクエストのたびに
 * 最新を描く」ことだけ。
 */
import { Router } from 'express';
import { collectNowPlaying, collectTopTracks } from '../core/collect.js';
import { renderNowPlayingCard, type PlaybackState } from '../render/card.js';
import { renderRankingCard } from '../render/ranking.js';
import { renderEmbedPage } from '../render/page.js';
import { albumArtAtSize, fetchImageDataUri } from '../render/image.js';
import { resolveTheme } from '../render/theme.js';
import { artCache } from '../cache/index.js';

const router = Router();

/** SVGはGitHubのcamo等がキャッシュする。こちら側では持たせない。 */
function sendSvg(res: import('express').Response, svg: string): void {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(svg);
}

/** 画像バイト列は使い回す。取得失敗は null のままキャッシュしない。 */
async function cachedArt(url: string, size: 640 | 300 | 64): Promise<string | null> {
  const target = albumArtAtSize(url, size);
  const cached = artCache.get<string>(target);
  if (cached) return cached;

  const dataUri = await fetchImageDataUri(target);
  if (dataUri) {
    try {
      artCache.set(target, dataUri);
    } catch {
      // キャッシュ満杯。次回再取得になるだけ。
    }
  }
  return dataUri;
}

router.get('/badge.svg', async (req, res, next) => {
  try {
    const data = await collectNowPlaying();
    const state: PlaybackState = data.is_playing && data.track ? 'playing' : 'idle';
    const art = data.track?.album_art_url
      ? await cachedArt(data.track.album_art_url, 300)
      : null;

    sendSvg(
      res,
      renderNowPlayingCard({
        state,
        track: data.track,
        mood: data.mood,
        since: data.fetched_at,
        artDataUri: art,
        theme: resolveTheme(req.query['theme'] as string | undefined),
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/ranking.svg', async (req, res, next) => {
  try {
    const data = await collectTopTracks();
    const count = parseCount(req.query['count']);
    const arts = await Promise.all(
      data.tracks
        .slice(0, count)
        .map((track) => (track.album_art_url ? cachedArt(track.album_art_url, 64) : null))
    );

    sendSvg(
      res,
      renderRankingCard({
        tracks: data.tracks,
        fetchedAt: data.fetched_at,
        count,
        artDataUris: arts,
        theme: resolveTheme(req.query['theme'] as string | undefined),
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/embed', async (req, res, next) => {
  try {
    const withRanking = req.query['ranking'] === 'true';
    const [nowPlaying, topTracks] = await Promise.all([
      collectNowPlaying(),
      withRanking ? collectTopTracks() : Promise.resolve(null),
    ]);

    const state: PlaybackState =
      nowPlaying.is_playing && nowPlaying.track ? 'playing' : 'idle';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      renderEmbedPage({
        nowPlaying,
        topTracks,
        state,
        since: nowPlaying.fetched_at,
        theme: resolveTheme(req.query['theme'] as string | undefined),
        transparent: req.query['transparent'] === 'true',
        // ページ自身が定期的に取得し直す。iframe を貼り替える必要はない。
        liveEndpoint: '/api/now-playing',
        refreshSeconds: parseRefresh(req.query['refresh']),
      })
    );
  } catch (err) {
    next(err);
  }
});

function parseCount(raw: unknown): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(value)) return 5;
  return Math.min(Math.max(value, 1), 10);
}

function parseRefresh(raw: unknown): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(value)) return 30;
  return Math.min(Math.max(value, 10), 3600);
}

export default router;
