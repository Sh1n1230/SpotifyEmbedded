/**
 * 埋め込み用のエンドポイント（ライブAPIモード）。
 *
 *   GET /embed        iframe 用HTMLページ
 *   GET /badge.svg    now-playing カードのSVG（GitHub README にも貼れる）
 *
 * ランキングは扱わない（静的モードの ranking.svg / top-tracks.json を使う）。
 *
 * SVG は静的モードと同じレンダラを使う。違いは「リクエストのたびに
 * 最新を描く」ことだけ。
 */
import { Hono, type Context } from 'hono';
import { collectNowPlaying } from '../core/collect.js';
import { renderNowPlayingCard, type PlaybackState } from '../render/card.js';
import { renderEmbedPage } from '../render/page.js';
import { albumArtAtSize, fetchImageDataUri } from '../render/image.js';
import { resolveTheme } from '../render/theme.js';
import { artCache } from '../cache/index.js';

const router = new Hono();

/** SVGはGitHubのcamo等がキャッシュする。こちら側では持たせない。 */
function sendSvg(c: Context, svg: string): Response {
  return c.body(svg, 200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
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

router.get('/badge.svg', async (c) => {
  const data = await collectNowPlaying();
  const state: PlaybackState = data.is_playing && data.track ? 'playing' : 'idle';
  const art = data.track?.album_art_url ? await cachedArt(data.track.album_art_url, 300) : null;

  return sendSvg(
    c,
    renderNowPlayingCard({
      state,
      track: data.track,
      mood: data.mood,
      since: data.fetched_at,
      artDataUri: art,
      theme: resolveTheme(c.req.query('theme')),
    })
  );
});

router.get('/embed', async (c) => {
  const nowPlaying = await collectNowPlaying();

  const state: PlaybackState = nowPlaying.is_playing && nowPlaying.track ? 'playing' : 'idle';

  return c.html(
    renderEmbedPage({
      nowPlaying,
      state,
      since: nowPlaying.fetched_at,
      theme: resolveTheme(c.req.query('theme')),
      transparent: c.req.query('transparent') === 'true',
      // ページ自身が定期的に取得し直す。iframe を貼り替える必要はない。
      liveEndpoint: '/api/now-playing',
      refreshSeconds: parseRefresh(c.req.query('refresh')),
    })
  );
});

function parseRefresh(raw: unknown): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(value)) return 30;
  return Math.min(Math.max(value, 10), 3600);
}

export default router;
