/**
 * 静的成果物の生成（サーバー不要モードの本体）。
 *
 * GitHub Actions から定期実行し、出力を公開ブランチへ push して
 * GitHub Pages で配信することを想定している。
 *
 * JSON はライブAPIと完全に同じスキーマ（src/types/index.ts）なので、
 * 利用側は fetch 先のURLを差し替えるだけで静的↔ライブを行き来できる。
 * カードと同じ「最後に聴いた曲」は、スキーマを変えないよう last-played.json に分けて書く。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toYaml } from '../core/yaml.js';

import {
  collectNowPlaying,
  collectRecentlyPlayed,
  collectTopTracks,
  type RecentlyPlayed,
} from '../core/collect.js';
import { resolveRankingMood, type RankingMoodRecord } from '../core/rankingMood.js';
import { llmKeyNotice, resolveLlm } from '../llm/settings.js';
import { missingAuthValues } from '../authStore.js';
import { isTopTracksRange } from '../core/topTracksParams.js';
import { VERSION } from '../version.js';
import { renderNowPlayingCard, type PlaybackState } from '../render/card.js';
import { renderRankingCard } from '../render/ranking.js';
import { renderEmbedPage } from '../render/page.js';
import { albumArtAtSize, fetchImageDataUri } from '../render/image.js';
import type {
  MoodResult,
  NowPlayingResponse,
  TopTracksLimit,
  TopTracksRange,
  TopTracksResponse,
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
  /** iframe 用ページ（index.html）のランキングの表示件数（1〜50）。省略すると count と同じ */
  pageCount?: number;
  /** ランキングのムード文を、顔ぶれの変化に関係なく作り直す */
  refreshRankingMood?: boolean;
  /**
   * 検索エンジンに載せてよい。既定（false）では index.html に noindex を入れ、robots.txt（Disallow: /）を書く。
   * 聴いている曲の履歴が検索結果に出るのを、明示的に選んだときだけにする。
   */
  allowIndexing?: boolean;
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
  /** その曲を「再生中」として最後に観測した時刻（履歴由来なら聴き終えた時刻） */
  observed_at: string;
  /**
   * ランキングのムード文と、その生成時点の上位曲。Actions の実行ごとに
   * LLM を呼ばないよう、顔ぶれが変わるまでここから使い回す。
   * これが導入される前のスナップショットには無い。
   * ムード文を作らない回（--no-mood・LLM 未設定・上位曲が0件・ランキングの取得の失敗）でも、前回の記録を
   * そのまま残す（表示には使わない）。消すと、次の通常の実行で LLM を呼び直すことになる。
   */
  ranking_mood?: RankingMoodRecord | null;
  /** このファイルの形の版（SNAPSHOT_SCHEMA_VERSION）。これが導入される前のスナップショットには無い（1 として読む） */
  schema_version?: number;
  /** 書いた generate の版（package.json の version）。不具合の切り分け用で、読むときの分岐には使わない */
  generator_version?: string;
}

/**
 * state が 'recent' のとき、どこから決めたか。ログを分けるためだけに使うので、snapshot.json には書かない。
 * history = 今回の再生履歴、carried = 前回のスナップショットを引き継いだ。
 */
type RecentSource = 'history' | 'carried';

const SNAPSHOT_FILE = 'snapshot.json';

/**
 * snapshot.json の形の版。読めない形に変えるときに上げる。自分より新しい版のファイルは形が分からないので
 * 読まずに作り直す（古い generate に戻したときに、新しい形を誤って解釈しない）。
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

const ROBOTS_FILE = 'robots.txt';
/**
 * すべてのクローラーに、すべてのパスを辿らせない。robots.txt はホストの直下でだけ効くので、
 * GitHub Pages のプロジェクトサイト（<user>.github.io/<repo>/）では効かない（独自ドメインやユーザーサイトの直下では効く）。
 * そのため index.html には noindex も入れる。JSON・SVG には入れられないので、README に注意を書いている。
 */
const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

/**
 * last-played.json / .yaml の中身。静的モード専用で、ライブAPIには無い。
 *
 * now-playing.json は Actions の実行時点の生の応答なので、停止中はほぼ track: null になる。
 * こちらは SVG・index.html と同じ曲（snapshot）を返す。
 * - 再生中: 再生中の曲。played_at は取得時刻
 * - 停止中: 最後に聴いた曲。played_at は聴き終えた時刻（履歴由来）か、
 *   前回の実行で再生中と観測した時刻（引き継ぎ）
 * - 履歴も前回データも無い: すべて null
 */
export interface LastPlayed {
  track: TrackSummary | null;
  mood: MoodResult | null;
  played_at: string | null;
}

export async function generate(options: GenerateOptions): Promise<void> {
  // 取得を始める前に、足りない値をまとめて知らせる（出力先のフォルダも作らない）
  const missing = missingAuthValues();
  if (missing.length > 0) {
    throw new Error(`Spotify の設定が見つかりません: ${missing.join(', ')}。\`npm run setup\` を実行してください。`);
  }

  // Spotify が返すのは最大 limit 件なので、それより多くは表示できない。指定と結果が食い違うまま続けず、取得の前に知らせる
  const pageCount = options.pageCount ?? options.count;
  for (const [flag, value] of [['--count', options.count], ['--page-count', pageCount]] as const) {
    if (value > options.limit) {
      throw new Error(
        `${flag} ${value} は --limit ${options.limit} を超えています。${flag} を ${options.limit} 以下にするか、--limit を上げてください。`
      );
    }
  }

  const outDir = resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });

  const llm = options.skipMood ? null : resolveLlm();
  if (llm?.kind === 'unconfigured') console.log('LLM が未設定のため、ムード文なしで生成します');
  if (llm?.kind === 'invalid') console.warn(`LLM の設定に誤りがあるため、ムード文なしで生成します: ${llm.problem}`);
  const notice = llm ? llmKeyNotice() : null;
  if (notice) console.log(notice);
  const wantMood = llm?.kind === 'ready';

  const previous = readSnapshot(outDir);

  console.log('Spotify からデータを取得しています...');
  // ランキングは数週間〜1年の集計なので、1回取れなくても前回の値で困らない。取れていた now-playing まで捨てない
  let rankingError: unknown = null;
  const [nowPlaying, fetchedTopTracks] = await Promise.all([
    timed('再生状況', () =>
      collectNowPlaying({
        bypassCache: true,
        skipMood: options.skipMood,
        // 前回と同じ曲を再生中なら、前回のムード文を使う（LLM を呼ばず、文も実行ごとに変わらない）
        knownMood: previous?.track && previous.mood ? { trackId: previous.track.id, mood: previous.mood } : null,
      })
    ),
    // ランキングのムード文は snapshot.json を根拠に下で決める
    timed('ランキング', () => collectTopTracks({ range: options.range, limit: options.limit })).catch(
      (err: unknown) => {
        rankingError = err;
        return null;
      }
    ),
  ]);
  if (!fetchedTopTracks) {
    const reason = rankingError instanceof Error ? rankingError.message : String(rankingError);
    console.warn(`[generate] ランキングを取得できませんでした。ランキングのファイルは前回のまま残します: ${forLog(reason)}`);
    // Actions では実行の一覧に注記として出す（ジョブは成功のまま。再生状況は更新できているため）
    if (process.env['GITHUB_ACTIONS']) console.log(`::warning title=ランキングを取得できませんでした::${forLog(reason)}`);
  }
  // iframe 用ページには、取れなかった回も前回のランキングを出す（無ければランキングなし）
  const topTracks = fetchedTopTracks ?? readPreviousTopTracks(outDir);

  // 停止中は、前回の観測より後に聴き終えた曲がないかを履歴で確かめる
  const recent = nowPlaying.is_playing
    ? null
    : await timed('再生履歴', () =>
        collectRecentlyPlayed({
          skipMood: options.skipMood,
          previous: previous?.track
            ? { trackId: previous.track.id, mood: previous.mood, observedAt: previous.observed_at }
            : null,
        })
      );

  // 記録（snapshot に残すもの）と、今回表示するものを分ける。作らない回・作れない回は記録を前回のまま残し、表示しない
  let rankingMood: RankingMoodRecord | null = previous?.ranking_mood ?? null;
  let shownRankingMood: MoodResult | null = null;
  if (fetchedTopTracks && wantMood && fetchedTopTracks.tracks.length > 0) {
    rankingMood = await timed('ランキングのムード文', () =>
      resolveRankingMood(fetchedTopTracks.range, fetchedTopTracks.tracks, previous?.ranking_mood ?? null, {
        force: options.refreshRankingMood === true,
      })
    );
    shownRankingMood = rankingMood?.mood ?? null;
    fetchedTopTracks.mood = shownRankingMood;
  }

  const resolved = resolveSnapshot(nowPlaying, recent, previous);
  const snapshot: Snapshot = {
    ...resolved.snapshot,
    ranking_mood: rankingMood,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    generator_version: VERSION,
  };
  logState(snapshot, resolved.source, shownRankingMood);

  // ジャケ写は SVG に焼き込むため data URI 化する（GitHub の camo 対策）
  const [cardArt, rankingArts] = await timed('ジャケ写', () =>
    Promise.all([
      snapshot.track?.album_art_url
        ? fetchImageDataUri(albumArtAtSize(snapshot.track.album_art_url, 300))
        : Promise.resolve(null),
      mapWithLimit(fetchedTopTracks?.tracks.slice(0, options.count) ?? [], IMAGE_CONCURRENCY, (track) =>
        track.album_art_url
          ? fetchImageDataUri(albumArtAtSize(track.album_art_url, rankingArtSize(options.count)))
          : Promise.resolve(null)
      ),
    ])
  );

  const outputs = new Map<string, string>();
  const themes = options.theme === 'both' ? (['dark', 'light'] as const) : ([options.theme] as const);

  for (const theme of themes) {
    const suffix = theme === 'light' ? '-light' : '';

    write(
      outputs,
      `now-playing${suffix}.svg`,
      renderNowPlayingCard({
        state: snapshot.state,
        track: snapshot.track,
        mood: snapshot.mood,
        since: snapshot.observed_at,
        // 数時間おきの生成なので、再生中でも「いつの情報か」を見出しに出す
        observedTime: true,
        now: nowPlaying.fetched_at,
        artDataUri: cardArt,
        theme,
      })
    );

    // 取れなかった回は書かない（前回のファイルがそのまま残る。空のランキングで上書きしない）
    if (fetchedTopTracks) {
      write(
        outputs,
        `ranking${suffix}.svg`,
        renderRankingCard({
          tracks: fetchedTopTracks.tracks,
          fetchedAt: fetchedTopTracks.fetched_at,
          range: fetchedTopTracks.range,
          mood: fetchedTopTracks.mood,
          count: options.count,
          artDataUris: rankingArts,
          theme,
        })
      );
    }
  }

  // データ（ライブAPIと同一スキーマ）
  write(outputs, 'now-playing.json', JSON.stringify(nowPlaying, null, 2) + '\n');
  write(outputs, 'now-playing.yaml', toYaml(nowPlaying));
  if (fetchedTopTracks) {
    write(outputs, 'top-tracks.json', JSON.stringify(fetchedTopTracks, null, 2) + '\n');
    write(outputs, 'top-tracks.yaml', toYaml(fetchedTopTracks));
  }

  // カードと同じ「最後に聴いた曲」（now-playing.json のスキーマは変えない）
  const lastPlayed = snapshotToLastPlayed(snapshot);
  write(outputs, 'last-played.json', JSON.stringify(lastPlayed, null, 2) + '\n');
  write(outputs, 'last-played.yaml', toYaml(lastPlayed));

  // iframe 用ページ（ホバー・Spotifyリンクが効く）。both のときはライトを -light に分ける
  // （SVG と同じ命名）。単独指定のときは今までどおり index.html だけ
  for (const theme of themes) {
    write(
      outputs,
      theme === 'light' && options.theme === 'both' ? 'index-light.html' : 'index.html',
      renderEmbedPage({
        nowPlaying: snapshotToResponse(snapshot, nowPlaying),
        topTracks,
        state: snapshot.state,
        since: snapshot.observed_at,
        observedTime: true,
        now: nowPlaying.fetched_at,
        noindex: options.allowIndexing !== true,
        theme,
        rankingCount: pageCount,
      })
    );
  }

  if (options.allowIndexing !== true) write(outputs, ROBOTS_FILE, ROBOTS_TXT);
  else removeOwnRobots(outDir);

  write(outputs, SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + '\n');

  flushOutputs(outDir, outputs);
  console.log(`\n生成しました: ${outDir}`);
  if (!process.env['CI']) {
    console.log('  README には now-playing.svg（ライトテーマは -light）、Web サイトには index.html を iframe で貼れます。');
    console.log('  貼り方: https://github.com/Sh1n1230/SpotifyEmbedded#4-埋め込みコードの配置');
  }
  writeStepSummary(snapshot, previous, shownRankingMood, fetchedTopTracks !== null);
}

/** 以前の実行が書いた robots.txt を消す（--index に切り替えたとき）。利用者が自分で置いた別の内容のものは触らない。 */
function removeOwnRobots(outDir: string): void {
  const path = join(outDir, ROBOTS_FILE);
  try {
    if (existsSync(path) && readFileSync(path, 'utf8') === ROBOTS_TXT) rmSync(path);
  } catch (err) {
    console.warn('[generate] %s を消せませんでした:', ROBOTS_FILE, err instanceof Error ? err.message : err);
  }
}

/**
 * 前回の実行が書いた top-tracks.json。ランキングを取得できなかった回に、iframe 用ページへ前回のランキングを出すために読む。
 * 無い・壊れている・形が違うときは null（ページはランキングなしになる）。
 */
function readPreviousTopTracks(outDir: string): TopTracksResponse | null {
  const path = join(outDir, 'top-tracks.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<TopTracksResponse> | null;
    if (!parsed || !isTopTracksRange(parsed.range) || typeof parsed.fetched_at !== 'string') return null;
    if (!Array.isArray(parsed.tracks) || !parsed.tracks.every(isRankingEntry)) return null;
    return parsed as TopTracksResponse;
  } catch {
    return null;
  }
}

/** 描画に使う項目が揃ったランキングの行か */
function isRankingEntry(value: unknown): boolean {
  if (!isTrackOrNull(value) || value === null) return false;
  return typeof (value as Record<string, unknown>)['rank'] === 'number';
}

/** Markdown の記号をエスケープする（曲名は外部由来で、ジョブのサマリーでリンクや見出しにさせない）。 */
function escapeMarkdown(value: string): string {
  return forLog(value).replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, '\\$&');
}

/** GitHub Actions のジョブのサマリーに結果を書く（Actions の外では何もしない。失敗しても生成は成功のまま）。 */
function writeStepSummary(
  snapshot: Snapshot,
  previous: Snapshot | null,
  rankingMood: MoodResult | null,
  rankingFetched: boolean
): void {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (!path) return;
  const regenerated = rankingMood !== null && rankingMood.generated_at !== previous?.ranking_mood?.mood.generated_at;
  const lines = [
    '### Spotify snapshot',
    '',
    `- 状態: ${snapshot.state}`,
    `- 曲: ${snapshot.track ? `${escapeMarkdown(snapshot.track.name)} / ${escapeMarkdown(snapshot.track.artist)}` : 'なし'}`,
    `- ムード文: ${snapshot.mood ? 'あり' : 'なし'}`,
    `- ランキング: ${rankingFetched ? '更新した' : '取得できなかったため前回のまま'}`,
    `- ランキングのムード文: ${rankingMood ? (regenerated ? '作り直した' : '前回のまま') : 'なし'}`,
    '',
  ];
  try {
    appendFileSync(path, lines.join('\n'));
  } catch (err) {
    console.warn('[generate] ジョブのサマリーを書けませんでした:', err instanceof Error ? err.message : err);
  }
}

/**
 * 再生中ならそれを、停止中なら「最後に聴いた曲」を決める。
 * 履歴が前回の観測を更新するなら履歴を、そうでなければ前回の観測結果を引き継ぐ。
 */
function resolveSnapshot(
  nowPlaying: NowPlayingResponse,
  recent: RecentlyPlayed | null,
  previous: Snapshot | null
): { snapshot: Snapshot; source: RecentSource | null } {
  if (nowPlaying.is_playing && nowPlaying.track) {
    return {
      source: null,
      snapshot: {
        state: 'playing',
        track: nowPlaying.track,
        mood: nowPlaying.mood,
        observed_at: nowPlaying.fetched_at,
      },
    };
  }

  // 採るべきかどうかは collectRecentlyPlayed が判定済み（採らないなら null）
  if (recent) {
    // observed_at には聴き終えた時刻を入れる。カードの「◯時間前」がこれで正しくなる。
    return {
      source: 'history',
      snapshot: { state: 'recent', track: recent.track, mood: recent.mood, observed_at: recent.played_at },
    };
  }

  if (previous?.track) {
    // observed_at は更新しない。更新すると「たった今」のまま固まってしまう。
    return {
      source: 'carried',
      snapshot: { state: 'recent', track: previous.track, mood: previous.mood, observed_at: previous.observed_at },
    };
  }

  return { source: null, snapshot: { state: 'idle', track: null, mood: null, observed_at: nowPlaying.fetched_at } };
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

/** last-played.json には、SVGと同じ曲をそのまま出す。 */
function snapshotToLastPlayed(snapshot: Snapshot): LastPlayed {
  if (!snapshot.track) return { track: null, mood: null, played_at: null };
  return { track: snapshot.track, mood: snapshot.mood, played_at: snapshot.observed_at };
}

function readSnapshot(outDir: string): Snapshot | null {
  const path = join(outDir, SNAPSHOT_FILE);
  if (!existsSync(path)) return null;

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isSnapshot(parsed)) return null;
    // 自分より新しい版の generate が書いたファイルは、形が分からないので読まない
    if (typeof parsed.schema_version === 'number' && parsed.schema_version > SNAPSHOT_SCHEMA_VERSION) {
      console.warn(
        '[generate] %s は新しい版（schema_version %d）で書かれているため、読まずに作り直します。',
        SNAPSHOT_FILE,
        parsed.schema_version
      );
      return null;
    }
    // 壊れていたら無視して作り直す（1回余分に LLM を呼ぶだけで済む）。
    if (!isRankingMoodRecord(parsed.ranking_mood)) parsed.ranking_mood = null;
    return parsed;
  } catch (err) {
    console.warn('[generate] %s を読めませんでした。無視します:', SNAPSHOT_FILE, err);
    return null;
  }
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  // 日時として読めない observed_at は描画で落ちるうえ、毎回復元されて直らないので捨てる。
  if (typeof snapshot['observed_at'] !== 'string' || Number.isNaN(Date.parse(snapshot['observed_at']))) return false;
  // state・track・mood も、描画が前提にする形でなければ同じく捨てる（復元のたびに描画で落ち続けないように）
  return isSnapshotState(snapshot['state']) && isTrackOrNull(snapshot['track']) && isMoodOrNull(snapshot['mood']);
}

function isSnapshotState(value: unknown): boolean {
  return value === 'playing' || value === 'recent' || value === 'idle';
}

/** null か、描画に使う TrackSummary の必須の項目が文字列で揃っているもの */
function isTrackOrNull(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const track = value as Record<string, unknown>;
  return ['id', 'name', 'artist', 'album', 'spotify_url'].every((key) => typeof track[key] === 'string');
}

function isMoodOrNull(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  const mood = value as Record<string, unknown>;
  return typeof mood['text'] === 'string' && typeof mood['generated_at'] === 'string';
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

/**
 * ログに出す外部由来の文字列（曲名・ムード文など）。改行と制御文字を空白に置き換えて1行に収める。
 * GitHub Actions は行頭の「::」をワークフローコマンドとして解釈するため、改行を含む曲名でコマンドを差し込めてしまう。
 */
export function forLog(value: string): string {
  // eslint-disable-next-line no-control-regex -- 制御文字を取り除くため、意図して指定している
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ');
}

function logState(snapshot: Snapshot, source: RecentSource | null, rankingMood: MoodResult | null): void {
  if (snapshot.state === 'playing' && snapshot.track) {
    console.log(`  再生中: ${forLog(snapshot.track.name)} / ${forLog(snapshot.track.artist)}`);
    if (snapshot.mood) console.log(`  ムード: ${forLog(snapshot.mood.text)}`);
  } else if (snapshot.state === 'recent' && snapshot.track && source === 'history') {
    console.log(`  停止中。再生履歴から最後に聴いた曲を取得しました: ${forLog(snapshot.track.name)}`);
    if (snapshot.mood) console.log(`  ムード: ${forLog(snapshot.mood.text)}`);
  } else if (snapshot.state === 'recent' && snapshot.track) {
    console.log(`  停止中。前回の観測を引き継ぎます: ${forLog(snapshot.track.name)}`);
  } else {
    console.log('  再生中の曲はなく、引き継げる前回データもありません。');
  }
  if (rankingMood) {
    console.log(`  ランキングのムード: ${forLog(rankingMood.text)}（${rankingMood.generated_at} 生成）`);
  }
}

/** どこで時間がかかっているかをログに残す。 */
async function timed<T>(label: string, task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const result = await task();
  console.log(`  ${label}: ${Date.now() - startedAt}ms`);
  return result;
}

function write(outputs: Map<string, string>, name: string, content: string): void {
  outputs.set(name, content);
}

/**
 * すべてを一時ファイルに書いてから、まとめて名前を変える。途中で失敗しても（描画の例外・ディスクの空き不足など）
 * 古い SVG と新しい JSON が混ざった出力を残さない。
 *
 * 中身が前回と同じファイルは書き直さない（更新時刻も変えない）。出力を git で管理している人の差分や、
 * 配信側の更新の検知を、実際に変わったファイルだけにする。fetched_at を含む JSON は毎回変わる。
 */
function flushOutputs(outDir: string, outputs: Map<string, string>): void {
  const entries = [...outputs]
    .map(([name, content]) => ({ name, content, target: join(outDir, name), temp: join(outDir, `.${name}.tmp`) }))
    .filter((entry) => {
      if (!isUnchanged(entry.target, entry.content)) return true;
      console.log(`  = ${entry.name}（変更なし）`);
      return false;
    });
  try {
    for (const entry of entries) writeFileSync(entry.temp, entry.content, 'utf8');
    for (const entry of entries) {
      renameSync(entry.temp, entry.target);
      console.log(`  ✓ ${entry.name}`);
    }
  } finally {
    for (const entry of entries) rmSync(entry.temp, { force: true });
  }
}

function isUnchanged(path: string, content: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, 'utf8') === content;
  } catch {
    return false;
  }
}

/**
 * ランキング SVG に焼き込むジャケ写のサイズ。44px で描くので、2倍の画面では 88px が要り、64px 版だとぼやける。
 * SVG は data URI で焼き込むしかなく（camo）、srcset のようにブラウザに選ばせられないので、件数で決める:
 * 300px 版は1枚 15〜30KB 程度（base64 で 20〜40KB）で、RANKING_ART_HIRES_MAX_COUNT 件までなら SVG は 0.5MB に収まる。
 * それより多い件数（最大 50）では 1MB を超えて README の表示が遅くなるので、64px 版（1枚 2〜3KB）にする。
 */
export const RANKING_ART_HIRES_MAX_COUNT = 10;

export function rankingArtSize(count: number): 300 | 64 {
  return count <= RANKING_ART_HIRES_MAX_COUNT ? 300 : 64;
}

/** ジャケ写の同時取得数。最大51枚を一度に取りに行かない。 */
const IMAGE_CONCURRENCY = 8;

/** 順番を保ったまま、同時に動かす数を limit までに抑える。 */
async function mapWithLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
