/**
 * ランキング全体のムード文と、その「失効」の判定。
 *
 * ランキングは数週間〜1年の集計なので、取得のたびに LLM を呼ぶのは無駄。
 * かといって TTL で切ると、何も変わっていないのに期限で呼び直し、逆に
 * 大きく変わっても期限まで古い文が残る。どちらも時間を基準にしているのが原因。
 *
 * そこでムード文を「ランキングの中身」に結びつける。生成時点の上位曲の顔ぶれを
 * 根拠（track_ids）として一緒に持ち、今の顔ぶれがそこから十分に入れ替わった
 * ときだけ作り直す。
 *
 * - 順位の入れ替わりは無視する（集合として比べる）。好みの傾向は変わらない。
 * - 比較対象は「前回見た顔ぶれ」ではなく「生成時点の顔ぶれ」。少しずつの変化も
 *   積み重なればいずれ閾値を超え、再生成される。
 * - 保存先は呼び出し側が選ぶ。ライブAPIはメモリ、静的モードは snapshot.json。
 *   判定はどちらも同じこの関数で行う。
 */
import { generateRankingMood } from '../llm/moodGenerator.js';
import { rangeLabelJa } from './topTracksParams.js';
import type { MoodResult, TopTrackEntry, TopTracksRange } from '../types/index.js';

/** 根拠にする上位曲の数。取得件数の最小値（10）と揃え、limit に依らず同じ文になる。 */
export const RANKING_MOOD_BASIS_SIZE = 10;

/** 生成時点から新顔がこの数を超えたら作り直す。 */
export const RANKING_MOOD_MAX_NEWCOMERS = 3;

export interface RankingMoodRecord {
  range: TopTracksRange;
  /** 生成時点の上位曲ID（順位順）。 */
  track_ids: string[];
  mood: MoodResult;
}

function basisOf(tracks: TopTrackEntry[]): string[] {
  return tracks.slice(0, RANKING_MOOD_BASIS_SIZE).map((t) => t.id);
}

/** 前回のムード文が今のランキングにもまだ当てはまるか。 */
export function isRankingMoodFresh(
  previous: RankingMoodRecord | null,
  range: TopTracksRange,
  trackIds: string[]
): boolean {
  if (!previous || previous.range !== range || trackIds.length === 0) return false;
  const before = new Set(previous.track_ids);
  const newcomers = trackIds.filter((id) => !before.has(id)).length;
  return newcomers <= RANKING_MOOD_MAX_NEWCOMERS;
}

/**
 * 前回の結果を使い回せればそのまま返し、そうでなければ生成する。
 * LLM の要否（設定の有無・skipMood）は呼び出し側で判断してから呼ぶこと。
 */
export async function resolveRankingMood(
  range: TopTracksRange,
  tracks: TopTrackEntry[],
  previous: RankingMoodRecord | null
): Promise<RankingMoodRecord | null> {
  const trackIds = basisOf(tracks);
  if (trackIds.length === 0) return null;
  if (previous && isRankingMoodFresh(previous, range, trackIds)) return previous;

  try {
    const text = await generateRankingMood({
      periodLabel: rangeLabelJa(range),
      tracks: tracks.slice(0, RANKING_MOOD_BASIS_SIZE),
    });
    return { range, track_ids: trackIds, mood: { text, generated_at: new Date().toISOString() } };
  } catch (err) {
    console.error(
      '[mood] ランキングのムード文を更新できませんでした:',
      err instanceof Error ? err.message : err
    );
    // 好みの傾向はゆっくり変わるので、古い文でも無いよりよい。
    // 根拠は更新しないので、次回また作り直しを試みる。
    return previous?.range === range ? previous : null;
  }
}
