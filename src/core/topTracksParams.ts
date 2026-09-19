/**
 * top-tracks の「期間」と「件数」の正規化。
 *
 * ライブAPIのクエリ文字列、CLIのオプション、レンダラの見出しが
 * すべて同じ語彙を使うよう、解釈と表示ラベルをここに集約する。
 * 不正な値は例外にせず既定値へ倒す（埋め込み先で壊れないことを優先）。
 */
import {
  TOP_TRACKS_RANGES,
  TOP_TRACKS_LIMITS,
  DEFAULT_TOP_TRACKS_RANGE,
  DEFAULT_TOP_TRACKS_LIMIT,
  DEFAULT_RANKING_COUNT,
  MAX_RANKING_COUNT,
  type TopTracksRange,
  type TopTracksLimit,
} from '../types/index.js';

export function isTopTracksRange(value: unknown): value is TopTracksRange {
  return TOP_TRACKS_RANGES.includes(value as TopTracksRange);
}

export function isTopTracksLimit(value: unknown): value is TopTracksLimit {
  return TOP_TRACKS_LIMITS.includes(value as TopTracksLimit);
}

/** クエリ/CLI由来の値を期間へ。未指定・不正値は既定（short_term）。 */
export function parseRange(raw: unknown): TopTracksRange {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TOP_TRACKS_RANGE;
  const value = String(raw).trim().toLowerCase();
  return isTopTracksRange(value) ? value : DEFAULT_TOP_TRACKS_RANGE;
}

/** 同上。3段階（10 / 30 / 50）のいずれでもなければ既定（50）。 */
export function parseLimit(raw: unknown): TopTracksLimit {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TOP_TRACKS_LIMIT;
  const value = Number.parseInt(String(raw), 10);
  return isTopTracksLimit(value) ? value : DEFAULT_TOP_TRACKS_LIMIT;
}

/** ランキングの表示件数。1〜50 に丸める。 */
export function parseCount(raw: unknown): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(value)) return DEFAULT_RANKING_COUNT;
  return Math.min(Math.max(value, 1), MAX_RANKING_COUNT);
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
