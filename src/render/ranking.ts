/**
 * top-tracks ランキングのSVG。
 *
 * top-tracks はどの期間でも数週間〜1年の集計なので、数時間古くても中身は
 * ほぼ変わらない。静的生成に向くのはこのため。ただしスナップショットで
 * あることが伝わるよう、ヘッダに取得日と集計期間を必ず入れる。
 */
import {
  DEFAULT_RANKING_COUNT,
  DEFAULT_TOP_TRACKS_RANGE,
  MAX_RANKING_COUNT,
  type MoodResult,
  type TopTrackEntry,
  type TopTracksRange,
} from '../types/index.js';
import { rangeLabelEn, rangeLabelJa } from '../core/topTracksParams.js';
import { THEMES, FONT_STACK, formatDateJa, type ThemeName } from './theme.js';
import { escapeXml, truncateToWidth, wrapToWidth } from './text.js';

export interface RankingInput {
  tracks: TopTrackEntry[];
  /** 取得時刻（ISO 8601）。ヘッダの「◯◯時点」に使う。 */
  fetchedAt: string;
  /** 集計期間。見出しの「4 WEEKS」等に使う。既定は short_term。 */
  range?: TopTracksRange | undefined;
  /** ランキング全体のムード文。あれば見出しの下に出す。 */
  mood?: MoodResult | null | undefined;
  /** 表示件数。1〜50。 */
  count?: number | undefined;
  /** ジャケ写の data URI。tracks と同じ並び順で、取得できなければ null。 */
  artDataUris?: (string | null)[] | undefined;
  theme?: ThemeName | undefined;
  /** 背景を透過するかどうか。既定値は true */
  transparent?: boolean | undefined;
}

const WIDTH = 460;
const PAD = 18;
const HEADER_HEIGHT = 50;
const MOOD_SIZE = 15;
const MOOD_LINE_HEIGHT = 22;
const ROW_HEIGHT = 56;
const ART_SIZE = 44;
const TEXT_X = 100;
const TEXT_WIDTH = WIDTH - TEXT_X - 20;

export function renderRankingCard(input: RankingInput): string {
  const theme = THEMES[input.theme ?? 'dark'];
  const isTransparent = input.transparent ?? true;
  const bgFill = isTransparent ? 'none' : theme.bg;

  const count = Math.min(Math.max(input.count ?? DEFAULT_RANKING_COUNT, 1), MAX_RANKING_COUNT);
  const tracks = input.tracks.slice(0, count);
  const range = input.range ?? DEFAULT_TOP_TRACKS_RANGE;

  const moodLines = input.mood?.text
    ? wrapToWidth(input.mood.text, (WIDTH - PAD * 2) / MOOD_SIZE, 2)
    : [];
  // ムード文の行数だけ見出しを伸ばし、区切り線と各行をその下へずらす。
  const headerHeight = HEADER_HEIGHT + (moodLines.length ? moodLines.length * MOOD_LINE_HEIGHT + 6 : 0);
  const moodSvg = moodLines
    .map(
      (line, i) =>
        `<text x="${PAD}" y="${58 + i * MOOD_LINE_HEIGHT}" font-size="${MOOD_SIZE}" font-weight="700" fill="${theme.fg}">${escapeXml(line)}</text>`
    )
    .join('\n    ');

  const height = headerHeight + Math.max(tracks.length, 1) * ROW_HEIGHT + 12;
  const fetchedAt = new Date(input.fetchedAt);
  const dateLabel = Number.isNaN(fetchedAt.getTime()) ? '' : `${formatDateJa(fetchedAt)} 時点`;

  const rows = tracks.length
    ? tracks
        .map((track, i) =>
          renderRow(track, i, headerHeight, input.artDataUris?.[i] ?? null, theme)
        )
        .join('\n    ')
    : `<text x="${PAD}" y="${headerHeight + 30}" font-size="13" fill="${theme.muted}">データがありません</text>`;

  const ariaLabel = `${rangeLabelJa(range)}のトップトラック${tracks.length}件${dateLabel ? `（${dateLabel}）` : ''}${input.mood?.text ? `: ${input.mood.text}` : ''}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escapeXml(ariaLabel)}">
  <title>${escapeXml(ariaLabel)}</title>
  <defs>
    <clipPath id="rank-art"><rect x="0" y="0" width="${ART_SIZE}" height="${ART_SIZE}" rx="5"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="12" fill="${bgFill}" stroke="${theme.border}"/>
  <g font-family="${FONT_STACK}">
    <text x="${PAD}" y="32" font-size="10" font-weight="600" letter-spacing="1.4" fill="${theme.accent}">TOP TRACKS · ${escapeXml(rangeLabelEn(range))}</text>
    <text x="${WIDTH - PAD}" y="32" font-size="10" fill="${theme.muted}" text-anchor="end">${escapeXml(dateLabel)}</text>
    ${moodSvg}
    <line x1="${PAD}" y1="${headerHeight - 8}" x2="${WIDTH - PAD}" y2="${headerHeight - 8}" stroke="${theme.border}"/>
    ${rows}
  </g>
</svg>
`;
}

function renderRow(
  track: TopTrackEntry,
  index: number,
  headerHeight: number,
  artDataUri: string | null,
  theme: (typeof THEMES)[ThemeName]
): string {
  const top = headerHeight + index * ROW_HEIGHT;
  const artY = top + 6;

  const art = artDataUri
    ? `<g transform="translate(${PAD + 26}, ${artY})"><image width="${ART_SIZE}" height="${ART_SIZE}" href="${artDataUri}" clip-path="url(#rank-art)" preserveAspectRatio="xMidYMid slice"/></g>`
    : `<rect x="${PAD + 26}" y="${artY}" width="${ART_SIZE}" height="${ART_SIZE}" rx="5" fill="${theme.placeholder}"/>`;

  return `${art}
    <text x="${PAD + 18}" y="${artY + 28}" font-size="13" font-weight="700" fill="${theme.muted}" text-anchor="end">${index + 1}</text>
    <text x="${TEXT_X}" y="${artY + 20}" font-size="13" font-weight="600" fill="${theme.fg}">${escapeXml(truncateToWidth(track.name, TEXT_WIDTH / 13))}</text>
    <text x="${TEXT_X}" y="${artY + 37}" font-size="11" fill="${theme.muted}">${escapeXml(truncateToWidth(track.artist, TEXT_WIDTH / 11))}</text>`;
}
