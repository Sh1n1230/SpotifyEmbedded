/**
 * top-tracks の「期間」と「件数」の正規化。
 *
 * CLIのオプションとレンダラの見出しが同じ語彙を使うよう、判定と
 * 表示ラベルをここに集約する。ランキングは静的モード専用。
 */
import {
  TOP_TRACKS_RANGES,
  TOP_TRACKS_LIMITS,
  type TopTracksRange,
  type TopTracksLimit,
} from '../types/index.js';

export function isTopTracksRange(value: unknown): value is TopTracksRange {
  return TOP_TRACKS_RANGES.includes(value as TopTracksRange);
}

export function isTopTracksLimit(value: unknown): value is TopTracksLimit {
  return TOP_TRACKS_LIMITS.includes(value as TopTracksLimit);
}

/** SVG / HTML の見出し用（例: "TOP TRACKS · 4 WEEKS"）。 */
const RANGE_LABELS_EN: Record<TopTracksRange, string> = {
  short_term: '4 WEEKS',
  medium_term: '6 MONTHS',
  long_term: '1 YEAR',
};

export function rangeLabelEn(range: TopTracksRange): string {
  return RANGE_LABELS_EN[range];
}

/** 読み上げ・本文用（例: "直近4週間"）。 */
const RANGE_LABELS_JA: Record<TopTracksRange, string> = {
  short_term: '直近4週間',
  medium_term: '直近6か月',
  long_term: '直近1年',
};

export function rangeLabelJa(range: TopTracksRange): string {
  return RANGE_LABELS_JA[range];
}
