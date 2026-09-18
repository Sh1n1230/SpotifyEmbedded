/**
 * 静的成果物の生成（サーバー不要モードの本体）。
 *
 * GitHub Actions から定期実行し、出力を公開ブランチへ push して
 * GitHub Pages で配信することを想定している。
 *
 * JSON はライブAPIと完全に同じスキーマ（src/types/index.ts）なので、
 * 利用側は fetch 先のURLを差し替えるだけで静的↔ライブを行き来できる。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

import { collectNowPlaying, collectTopTracks } from '../core/collect.js';
import { renderNowPlayingCard, type PlaybackState } from '../render/card.js';
import { renderRankingCard } from '../render/ranking.js';
import { renderEmbedPage } from '../render/page.js';
import { albumArtAtSize, fetchImageDataUri } from '../render/image.js';
import type {
  MoodResult,
  NowPlayingResponse,
  TopTracksResponse,
  TrackSummary,
} from '../types/index.js';

export interface GenerateOptions {
  outDir: string;
  /** ランキングの表示件数（1〜10） */
  count: number;
  /** 'dark' | 'light' | 'both' */
  theme: 'dark' | 'light' | 'both';
  /** ムード生成をスキップする（GROQ_API_KEY 不要で動かす） */
  skipMood: boolean;
}

/**
 * 静的モード専用の状態ファイル。
 *
 * Spotify は停止中だと何も返さないため、これが無いと生成物が
 * 「再生していません」ばかりになる。前回の観測結果を持ち越して
 * 「最後に聴いていた曲」として見せるために使う。
 * 公開APIのスキーマを汚さないよう、別ファイルに分けている。
 */
interface Snapshot {
  state: PlaybackState;
  track: TrackSummary | null;
  mood: MoodResult | null;
  /** その曲を「再生中」として最後に観測した時刻 */
  observed_at: string;
}

const SNAPSHOT_FILE = 'snapshot.json';

export async function generate(options: GenerateOptions): Promise<void> {
  const outDir = resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });

  console.log('Spotify からデータを取得しています...');
  const [nowPlaying, topTracks] = await Promise.all([
    collectNowPlaying({ bypassCache: true, skipMood: options.skipMood }),
    collectTopTracks({ bypassCache: true }),
  ]);

  const snapshot = resolveSnapshot(nowPlaying, readSnapshot(outDir));
  logState(snapshot);

  // ジャケ写は SVG に焼き込むため data URI 化する（GitHub の camo 対策）
  const [cardArt, rankingArts] = await Promise.all([
    snapshot.track?.album_art_url
      ? fetchImageDataUri(albumArtAtSize(snapshot.track.album_art_url, 300))
      : Promise.resolve(null),
    Promise.all(
      topTracks.tracks
        .slice(0, options.count)
        .map((track) =>
          track.album_art_url
            ? fetchImageDataUri(albumArtAtSize(track.album_art_url, 64))
            : Promise.resolve(null)
        )
    ),
  ]);

  const themes = options.theme === 'both' ? (['dark', 'light'] as const) : ([options.theme] as const);

  for (const theme of themes) {
    const suffix = theme === 'light' ? '-light' : '';

    write(
      outDir,
      `now-playing${suffix}.svg`,
      renderNowPlayingCard({
        state: snapshot.state,
        track: snapshot.track,
        mood: snapshot.mood,
        since: snapshot.observed_at,
        artDataUri: cardArt,
        theme,
      })
    );

    write(
      outDir,
      `ranking${suffix}.svg`,
      renderRankingCard({
        tracks: topTracks.tracks,
        fetchedAt: topTracks.fetched_at,
        count: options.count,
        artDataUris: rankingArts,
        theme,
      })
    );
  }

  // データ（ライブAPIと同一スキーマ）
  write(outDir, 'now-playing.json', JSON.stringify(nowPlaying, null, 2) + '\n');
  write(outDir, 'top-tracks.json', JSON.stringify(topTracks, null, 2) + '\n');
  write(outDir, 'now-playing.yaml', yaml.dump(nowPlaying, { lineWidth: 120 }));
  write(outDir, 'top-tracks.yaml', yaml.dump(topTracks, { lineWidth: 120 }));

  // iframe 用ページ（ホバー・Spotifyリンクが効く）
  write(
    outDir,
    'index.html',
    renderEmbedPage({
      nowPlaying: snapshotToResponse(snapshot, nowPlaying),
      topTracks,
      state: snapshot.state,
      since: snapshot.observed_at,
      theme: options.theme === 'light' ? 'light' : 'dark',
    })
  );

  write(outDir, SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + '\n');

  console.log(`\n生成しました: ${outDir}`);
}

/** 再生中ならそれを、停止中なら前回の観測結果を引き継ぐ。 */
function resolveSnapshot(
  nowPlaying: NowPlayingResponse,
  previous: Snapshot | null
): Snapshot {
  if (nowPlaying.is_playing && nowPlaying.track) {
    return {
      state: 'playing',
      track: nowPlaying.track,
      mood: nowPlaying.mood,
      observed_at: nowPlaying.fetched_at,
    };
  }

  if (previous?.track) {
    // observed_at は更新しない。更新すると「たった今」のまま固まってしまう。
    return { ...previous, state: 'recent' };
  }

  return { state: 'idle', track: null, mood: null, observed_at: nowPlaying.fetched_at };
}

/** iframe ページには、SVGと同じ「最後に聴いた曲」を見せる。 */
function snapshotToResponse(
  snapshot: Snapshot,
  nowPlaying: NowPlayingResponse
): NowPlayingResponse {
  if (snapshot.state === 'playing') return nowPlaying;
  return {
    is_playing: false,
    track: snapshot.track,
    mood: snapshot.mood,
    fetched_at: nowPlaying.fetched_at,
  };
}

function readSnapshot(outDir: string): Snapshot | null {
  const path = join(outDir, SNAPSHOT_FILE);
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.observed_at !== 'string') return null;
    return parsed;
  } catch (err) {
    console.warn(`[generate] ${SNAPSHOT_FILE} を読めませんでした。無視します:`, err);
    return null;
  }
}

function logState(snapshot: Snapshot): void {
  if (snapshot.state === 'playing' && snapshot.track) {
    console.log(`  再生中: ${snapshot.track.name} / ${snapshot.track.artist}`);
    if (snapshot.mood) console.log(`  ムード: ${snapshot.mood.text}`);
  } else if (snapshot.state === 'recent' && snapshot.track) {
    console.log(`  停止中。前回の観測を引き継ぎます: ${snapshot.track.name}`);
  } else {
    console.log('  再生中の曲はなく、引き継げる前回データもありません。');
  }
}

function write(outDir: string, name: string, content: string): void {
  writeFileSync(join(outDir, name), content, 'utf8');
  console.log(`  ✓ ${name}`);
}
