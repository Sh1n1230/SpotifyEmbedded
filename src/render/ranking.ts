/**
 * top-tracks ランキングのSVG。
 *
 * top-tracks は short_term（約4週間の集計）なので、数時間古くても中身は
 * ほぼ変わらない。静的生成に向くのはこのため。ただしスナップショットで
 * あることが伝わるよう、ヘッダに取得日を必ず入れる。
 */
import type { TopTrackEntry } from '../types/index.js';
import { THEMES, FONT_STACK, formatDateJa, type ThemeName } from './theme.js';
import { escapeXml, truncateToWidth } from './text.js';

export interface RankingInput {
  tracks: TopTrackEntry[];
  /** 取得時刻（ISO 8601）。ヘッダの「◯◯時点」に使う。 */
  fetchedAt: string;
  /** 表示件数。1〜10。 */
  count?: number | undefined;
  /** ジャケ写の data URI。tracks と同じ並び順で、取得できなければ null。 */
  artDataUris?: (string | null)[] | undefined;
  theme?: ThemeName | undefined;
}

const WIDTH = 460;
const PAD = 18;
const HEADER_HEIGHT = 50;
const ROW_HEIGHT = 56;
const ART_SIZE = 44;
const TEXT_X = 100;
const TEXT_WIDTH = WIDTH - TEXT_X - 20;

export function renderRankingCard(input: RankingInput): string {
  const theme = THEMES[input.theme ?? 'dark'];
  const count = Math.min(Math.max(input.count ?? 5, 1), 10);
  const tracks = input.tracks.slice(0, count);

  const height = HEADER_HEIGHT + Math.max(tracks.length, 1) * ROW_HEIGHT + 12;
  const fetchedAt = new Date(input.fetchedAt);
  const dateLabel = Number.isNaN(fetchedAt.getTime()) ? '' : `${formatDateJa(fetchedAt)} 時点`;

  const rows = tracks.length
    ? tracks
        .map((track, i) => renderRow(track, i, input.artDataUris?.[i] ?? null, theme))
        .join('\n    ')
    : `<text x="${PAD}" y="${HEADER_HEIGHT + 30}" font-size="13" fill="${theme.muted}">データがありません</text>`;

  const ariaLabel = `直近4週間のトップトラック${tracks.length}件${dateLabel ? `（${dateLabel}）` : ''}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escapeXml(ariaLabel)}">
  <title>${escapeXml(ariaLabel)}</title>
  <defs>
    <clipPath id="rank-art"><rect x="0" y="0" width="${ART_SIZE}" height="${ART_SIZE}" rx="5"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="12" fill="${theme.bg}" stroke="${theme.border}"/>
  <g font-family="${FONT_STACK}">
    <text x="${PAD}" y="32" font-size="10" font-weight="600" letter-spacing="1.4" fill="${theme.accent}">TOP TRACKS · 4 WEEKS</text>
    <text x="${WIDTH - PAD}" y="32" font-size="10" fill="${theme.muted}" text-anchor="end">${escapeXml(dateLabel)}</text>
    <line x1="${PAD}" y1="${HEADER_HEIGHT - 8}" x2="${WIDTH - PAD}" y2="${HEADER_HEIGHT - 8}" stroke="${theme.border}"/>
    ${rows}
  </g>
</svg>
`;
}

function renderRow(
  track: TopTrackEntry,
  index: number,
  artDataUri: string | null,
  theme: (typeof THEMES)[ThemeName]
): string {
  const top = HEADER_HEIGHT + index * ROW_HEIGHT;
  const artY = top + 6;

  const art = artDataUri
    ? `<g transform="translate(${PAD + 26}, ${artY})"><image width="${ART_SIZE}" height="${ART_SIZE}" href="${artDataUri}" clip-path="url(#rank-art)" preserveAspectRatio="xMidYMid slice"/></g>`
    : `<rect x="${PAD + 26}" y="${artY}" width="${ART_SIZE}" height="${ART_SIZE}" rx="5" fill="${theme.placeholder}"/>`;

  return `${art}
    <text x="${PAD + 18}" y="${artY + 28}" font-size="13" font-weight="700" fill="${theme.muted}" text-anchor="end">${index + 1}</text>
    <text x="${TEXT_X}" y="${artY + 20}" font-size="13" font-weight="600" fill="${theme.fg}">${escapeXml(truncateToWidth(track.name, TEXT_WIDTH / 13))}</text>
    <text x="${TEXT_X}" y="${artY + 37}" font-size="11" fill="${theme.muted}">${escapeXml(truncateToWidth(track.artist, TEXT_WIDTH / 11))}</text>`;
}
