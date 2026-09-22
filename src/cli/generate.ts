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
import { resolveRankingMood, type RankingMoodRecord } from '../core/rankingMood.js';
import { hasLlmConfigured } from '../authStore.js';
import { renderNowPlayingCard, type PlaybackState } from '../render/card.js';
import { renderRankingCard } from '../render/ranking.js';
import { renderEmbedPage } from '../render/page.js';
import { albumArtAtSize, fetchImageDataUri } from '../render/image.js';
import type {
  MoodResult,
  NowPlayingResponse,
  TopTracksResponse,
  TopTracksLimit,
  TopTracksRange,
  TrackSummary,
} from '../types/index.js';

export interface GenerateOptions {
  outDir: string;
  /** ランキングの表示件数（1〜50） */
  count: number;
  /** 集計期間（short_term | medium_term | long_term） */
  range: TopTracksRange;
  /** Spotify から取得する件数（10 / 30 / 50） */
  limit: TopTracksLimit;
  /** 'dark' | 'light' | 'both' */
  theme: 'dark' | 'light' | 'both';
  /** ムード生成をスキップする（LLM設定なしで動かす） */
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
  /**
   * ランキングのムード文と、その生成時点の上位曲。Actions の実行ごとに
   * LLM を呼ばないよう、顔ぶれが変わるまでここから使い回す。
   * これが導入される前のスナップショットには無い。
   */
  ranking_mood?: RankingMoodRecord | null;
}

const SNAPSHOT_FILE = 'snapshot.json';

export async function generate(options: GenerateOptions): Promise<void> {
  const outDir = resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });

  if (options.count > options.limit) {
    console.warn(
      `[generate] --count ${options.count} は --limit ${options.limit} を超えています。` +
        `表示されるのは最大 ${options.limit} 件です。`
    );
  }

  console.log('Spotify からデータを取得しています...');
  const [nowPlaying, topTracks] = await Promise.all([
    collectNowPlaying({ bypassCache: true, skipMood: options.skipMood }),
    // ランキングのムード文はメモリではなく snapshot.json を根拠に決めるので、
    // ここでは生成させない（プロセスは毎回まっさらで、メモリは持ち越せない）。
    collectTopTracks({
      bypassCache: true,
      skipMood: true,
      range: options.range,
      limit: options.limit,
    }),
  ]);

  const previous = readSnapshot(outDir);
  const rankingMood =
    !options.skipMood && hasLlmConfigured()
      ? await resolveRankingMood(topTracks.range, topTracks.tracks, previous?.ranking_mood ?? null)
      : null;
  topTracks.mood = rankingMood?.mood ?? null;

  const snapshot: Snapshot = {
    ...resolveSnapshot(nowPlaying, previous),
    ranking_mood: rankingMood,
  };
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
        range: topTracks.range,
        mood: topTracks.mood,
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
      rankingCount: options.count,
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
    // 壊れていたら無視して作り直す（1回余分に LLM を呼ぶだけで済む）。
    if (!isRankingMoodRecord(parsed.ranking_mood)) parsed.ranking_mood = null;
    return parsed;
  } catch (err) {
    console.warn(`[generate] ${SNAPSHOT_FILE} を読めませんでした。無視します:`, err);
    return null;
  }
}

function isRankingMoodRecord(value: unknown): value is RankingMoodRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RankingMoodRecord>;
  return (
    typeof record.range === 'string' &&
    Array.isArray(record.track_ids) &&
    record.track_ids.every((id) => typeof id === 'string') &&
    typeof record.mood?.text === 'string' &&
    typeof record.mood.generated_at === 'string'
  );
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
  if (snapshot.ranking_mood) {
    console.log(
      `  ランキングのムード: ${snapshot.ranking_mood.mood.text}` +
        `（${snapshot.ranking_mood.mood.generated_at} 生成）`
    );
  }
}

function write(outDir: string, name: string, content: string): void {
  writeFileSync(join(outDir, name), content, 'utf8');
  console.log(`  ✓ ${name}`);
}
