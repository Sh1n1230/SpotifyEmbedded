/**
 * now-playing カードのSVG。
 *
 * このプロジェクトの主役は「AIが生成した日本語のムード文」なので、
 * 曲名ではなくムード文を最も大きく組む。曲名・アーティストは出典として
 * その下に添える。
 */
import type { TrackSummary, MoodResult } from '../types/index.js';
import { THEMES, FONT_STACK, relativeTimeJa, type ThemeName } from './theme.js';
import { escapeXml, wrapToWidth, truncateToWidth } from './text.js';

export type PlaybackState =
  /** 再生中 */
  | 'playing'
  /** 停止中だが、直近に聴いていた曲が分かっている（静的モード） */
  | 'recent'
  /** 何も分からない */
  | 'idle';

export interface CardInput {
  state: PlaybackState;
  track: TrackSummary | null;
  mood: MoodResult | null;
  /** state が 'recent' のときの、その曲を確認した時刻 */
  since?: string | undefined;
  /** ジャケ写の data URI。null ならプレースホルダを描く。 */
  artDataUri?: string | null | undefined;
  theme?: ThemeName | undefined;
  /** 背景を透過するかどうか。既定値は true */
  transparent?: boolean | undefined;
}

const WIDTH = 460;
const HEIGHT = 160;
const PAD = 18;
const ART_SIZE = 124;
const TEXT_X = PAD + ART_SIZE + 16;
const TEXT_WIDTH = WIDTH - TEXT_X - 20;

export function renderNowPlayingCard(input: CardInput): string {
  const theme = THEMES[input.theme ?? 'dark'];
  const { state, track, mood } = input;
  const isTransparent = input.transparent ?? true;
  const bgFill = isTransparent ? 'none' : theme.bg;

  const label = labelFor(state, input.since);
  const hasArt = state !== 'idle';

  const body = state === 'idle' || !track
    ? renderIdleBody(theme.muted)
    : renderTrackBody(track, mood, theme);

  const ariaLabel = buildAriaLabel(state, track, mood);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(ariaLabel)}">
  <title>${escapeXml(ariaLabel)}</title>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="12" fill="${bgFill}" stroke="${theme.border}"/>
  ${hasArt ? renderArt(input.artDataUri ?? null, theme.placeholder, theme.muted) : ''}
  <g font-family="${FONT_STACK}">
    ${renderLabel(label, state, theme.accent, theme.muted, hasArt ? TEXT_X : PAD)}
    ${body}
  </g>
</svg>
`;
}

function labelFor(state: PlaybackState, since: string | undefined): string {
  if (state === 'playing') return 'NOW PLAYING';
  if (state === 'recent') {
    const at = since ? new Date(since) : null;
    const when = at && !Number.isNaN(at.getTime()) ? relativeTimeJa(at) : null;
    return when ? `LAST PLAYED · ${when}` : 'LAST PLAYED';
  }
  return 'NOTHING PLAYING';
}

function renderArt(dataUri: string | null, placeholder: string, muted: string): string {
  if (dataUri) {
    // clipPath ではなく rect を重ねず、image に直接角丸を効かせるため clip-path を使う
    return `<defs><clipPath id="art-clip"><rect x="${PAD}" y="${PAD}" width="${ART_SIZE}" height="${ART_SIZE}" rx="8"/></clipPath></defs>
  <image x="${PAD}" y="${PAD}" width="${ART_SIZE}" height="${ART_SIZE}" href="${dataUri}" clip-path="url(#art-clip)" preserveAspectRatio="xMidYMid slice"/>`;
  }

  return `<rect x="${PAD}" y="${PAD}" width="${ART_SIZE}" height="${ART_SIZE}" rx="8" fill="${placeholder}"/>
  <text x="${PAD + ART_SIZE / 2}" y="${PAD + ART_SIZE / 2 + 5}" font-family="${FONT_STACK}" font-size="13" fill="${muted}" text-anchor="middle">no art</text>`;
}

function renderLabel(
  label: string,
  state: PlaybackState,
  accent: string,
  muted: string,
  x: number
): string {
  const color = state === 'playing' ? accent : muted;
  const baseline = 44;

  if (state !== 'playing') {
    return `<text x="${x}" y="${baseline}" font-size="10" font-weight="600" letter-spacing="1.4" fill="${color}">${escapeXml(label)}</text>`;
  }

  return `${equalizer(x, baseline, accent)}
    <text x="${x + 20}" y="${baseline}" font-size="10" font-weight="600" letter-spacing="1.4" fill="${color}">${escapeXml(label)}</text>`;
}

/** 再生中インジケータ。SMILアニメーションはGitHubのcamo経由でも動く。 */
function equalizer(x: number, baselineY: number, color: string): string {
  const bars = [
    { dx: 0, dur: '0.9s', heights: [4, 12, 4] },
    { dx: 5.5, dur: '1.25s', heights: [11, 4, 11] },
    { dx: 11, dur: '0.75s', heights: [6, 13, 6] },
  ];

  return bars
    .map(({ dx, dur, heights }) => {
      const h = heights.join(';');
      // 下端を baselineY に固定するため y も height に合わせて動かす
      const y = heights.map((v) => baselineY - v).join(';');
      return `<rect x="${x + dx}" y="${baselineY - (heights[0] ?? 4)}" width="3" height="${heights[0] ?? 4}" rx="1.5" fill="${color}">
      <animate attributeName="height" values="${h}" dur="${dur}" repeatCount="indefinite"/>
      <animate attributeName="y" values="${y}" dur="${dur}" repeatCount="indefinite"/>
    </rect>`;
    })
    .join('\n    ');
}

function renderTrackBody(track: TrackSummary, mood: MoodResult | null, theme: Theme): string {
  const parts: string[] = [];
  let artistY: number;

  if (mood?.text) {
    const moodSize = 19;
    const lines = wrapToWidth(mood.text, TEXT_WIDTH / moodSize, 2);
    // 1行なら縦位置を下げて、ジャケ写に対する重心を合わせる
    const firstY = lines.length > 1 ? 72 : 82;

    lines.forEach((line, i) => {
      parts.push(
        `<text x="${TEXT_X}" y="${firstY + i * 23}" font-size="${moodSize}" font-weight="700" fill="${theme.fg}">${escapeXml(line)}</text>`
      );
    });

    // ムードが主役のとき、曲名は出典として下に添える
    parts.push(
      `<text x="${TEXT_X}" y="124" font-size="12.5" fill="${theme.sub}">${escapeXml(truncateToWidth(track.name, TEXT_WIDTH / 12.5))}</text>`
    );
    artistY = 142;
  } else {
    // ムードが無い場合（LLM未設定・失敗時）は曲名を主役に昇格させる
    const size = 17;
    const lines = wrapToWidth(track.name, TEXT_WIDTH / size, 2);
    const firstY = lines.length > 1 ? 74 : 84;

    lines.forEach((line, i) => {
      parts.push(
        `<text x="${TEXT_X}" y="${firstY + i * 21}" font-size="${size}" font-weight="700" fill="${theme.fg}">${escapeXml(line)}</text>`
      );
    });

    // 曲名とアーティストは一体のブロックとして扱い、行数に追従させる
    artistY = firstY + (lines.length - 1) * 21 + 24;
  }

  parts.push(
    `<text x="${TEXT_X}" y="${artistY}" font-size="11.5" fill="${theme.muted}">${escapeXml(truncateToWidth(track.artist, TEXT_WIDTH / 11.5))}</text>`
  );

  return parts.join('\n    ');
}

function renderIdleBody(muted: string): string {
  return `<text x="${PAD}" y="84" font-size="17" font-weight="700" fill="${muted}">再生していません</text>`;
}

function buildAriaLabel(
  state: PlaybackState,
  track: TrackSummary | null,
  mood: MoodResult | null
): string {
  if (!track) return '再生していません';
  const prefix = state === 'playing' ? '再生中' : '最後に再生';
  const moodText = mood?.text ? `${mood.text} — ` : '';
  return `${prefix}: ${moodText}${track.name} / ${track.artist}`;
}

type Theme = (typeof THEMES)[ThemeName];
