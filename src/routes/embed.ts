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
import type { NowPlayingResponse } from '../types/index.js';

const router = new Hono();

/**
 * SVG を直接開かれたときに備える CSP。画像は data URI で埋めているので外部は一切不要。
 * スクリプトは持たないので全面禁止。
 */
const SVG_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/** SVGはGitHubのcamo等がキャッシュする。こちら側では持たせない。 */
function sendSvg(c: Context, svg: string): Response {
  return c.body(svg, 200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Security-Policy': SVG_CSP,
  });
}

/**
 * /embed の CSP。スクリプトはライブ更新の1本だけを nonce で許す。
 * ジャケ写は Spotify の CDN（ホストが複数ある）から https で読む。
 * frame-ancestors は付けない: 他サイトの iframe に入るためのページなので。
 */
function embedCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    'img-src https: data:',
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Workers と Node の両方にある Web Crypto で作る。 */
function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
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

/**
 * /badge.svg は README の <img>、/embed は他サイトの <iframe> から読まれる。どちらも
 * JSON のエラーは描けず、壊れた画像や生の JSON に見えてしまうので、Spotify 側の失敗
 * （認証切れ・429・5xx など）でも「取得できませんでした」のカードを 200 で返す。
 * camo は 2xx 以外の画像を表示しないため、失敗の事実はヘッダーで示す。
 * 詳細はログにだけ出す。/api/now-playing は従来どおり JSON のエラーを返す。
 */
const ERROR_HEADER = 'X-Spotify-Embedded-Error';

async function nowPlayingOrNull(c: Context): Promise<NowPlayingResponse | null> {
  try {
    return await collectNowPlaying();
  } catch (err) {
    console.error('[embed] 再生状況を取得できませんでした:', err instanceof Error ? err.message : err);
    c.header(ERROR_HEADER, 'spotify_unavailable');
    return null;
  }
}

router.get('/badge.svg', async (c) => {
  const theme = resolveTheme(c.req.query('theme'));
  const data = await nowPlayingOrNull(c);
  if (!data) {
    return sendSvg(c, renderNowPlayingCard({ state: 'idle', track: null, mood: null, theme, unavailable: true }));
  }

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
      theme,
    })
  );
});

router.get('/embed', async (c) => {
  const fetched = await nowPlayingOrNull(c);
  const nowPlaying: NowPlayingResponse = fetched ?? {
    is_playing: false,
    track: null,
    mood: null,
    fetched_at: new Date().toISOString(),
  };

  const state: PlaybackState = nowPlaying.is_playing && nowPlaying.track ? 'playing' : 'idle';
  const nonce = makeNonce();
  c.header('Content-Security-Policy', embedCsp(nonce));

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
      scriptNonce: nonce,
      unavailable: fetched === null,
    })
  );
});

function parseRefresh(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(value)) return 30;
  return Math.min(Math.max(value, 10), 3600);
}

export default router;
