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
export function rangeLabelEn(range: TopTracksRange): string {
  switch (range) {
    case 'medium_term':
      return '6 MONTHS';
    case 'long_term':
      return '1 YEAR';
    default:
      return '4 WEEKS';
  }
}

/** 読み上げ・本文用（例: "直近4週間"）。 */
export function rangeLabelJa(range: TopTracksRange): string {
  switch (range) {
    case 'medium_term':
      return '直近6か月';
    case 'long_term':
      return '直近1年';
    default:
      return '直近4週間';
  }
}
