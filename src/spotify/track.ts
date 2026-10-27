/**
 * Spotify の生のトラックを公開スキーマ（src/types/index.ts の TrackSummary）に直す。
 *
 * now-playing・recently-played・top-tracks のすべてがここを通る。片方だけ直すと
 * ライブAPIの now-playing と静的モードの top-tracks.json でフィールドの意味がずれるため、
 * 対応づけはこの1か所に置く。
 */
import type { SpotifyImage, SpotifyTrack, TrackSummary } from '../types/index.js';

/** Spotify のカタログにある曲。`id` が必ず文字列になる。 */
export type CatalogTrack = SpotifyTrack & { id: string };

/** 300px 以上の最大サイズ。無ければ先頭、画像が無ければ空文字。 */
export function pickAlbumArt(images: SpotifyImage[]): string {
  const large = images
    .filter((img) => img.width !== null && img.width >= 300)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (large[0] ?? images[0])?.url ?? '';
}

/**
 * Spotify のカタログにある曲か。
 *
 * ローカルファイル（`is_local: true`）は `id`・`external_urls`・アーティストの `id` が
 * すべて空で返る。公開スキーマ（`id` と `spotify_url` は文字列）を満たせず、
 * ジャンルも引けないので、now-playing でも recently-played でも採らない。
 * https://developer.spotify.com/documentation/web-api/concepts/playlists#local-files
 */
export function isCatalogTrack(item: SpotifyTrack): item is CatalogTrack {
  return item.is_local !== true && typeof item.id === 'string' && item.id !== '';
}

/** Spotify の生のトラックを、公開スキーマの形に揃える。 */
export function toTrackSummary(item: CatalogTrack): TrackSummary {
  return {
    id: item.id,
    name: item.name,
    artist: item.artists.map((a) => a.name).join(', '),
    album: item.album.name,
    album_art_url: pickAlbumArt(item.album.images),
    duration_ms: item.duration_ms,
    // popularity は 2024年11月以降のアプリでは返らない。欠けていても
    // キー自体はスキーマに残す（利用側の分岐を増やさないため）。
    popularity: item.popularity ?? null,
    spotify_url: item.external_urls.spotify,
    preview_url: item.preview_url ?? null,
  };
}
