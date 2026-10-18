/**
 * カード描画のデザイントークン。SVG と iframe用HTML で共有する。
 */

export interface Theme {
  bg: string;
  surface: string;
  fg: string;
  /** 曲名など、ムード文より一段落とす情報 */
  sub: string;
  /** アーティスト名・補助ラベル */
  muted: string;
  accent: string;
  border: string;
  /** ジャケ写が取得できなかったときのプレースホルダ */
  placeholder: string;
}

export const THEMES = {
  dark: {
    bg: '#0e1013',
    surface: '#161a1f',
    fg: '#f2f4f7',
    sub: '#c7cdd6',
    muted: '#8b95a1',
    accent: '#1db954',
    border: '#232931',
    placeholder: '#1e242b',
  },
  light: {
    bg: '#ffffff',
    surface: '#f7f8fa',
    fg: '#11151a',
    sub: '#39424d',
    muted: '#6b7681',
    accent: '#1aa34a',
    border: '#e4e8ed',
    placeholder: '#eceff3',
  },
} satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;

export function resolveTheme(name: string | undefined): ThemeName {
  return name === 'light' ? 'light' : 'dark';
}

/**
 * 日本語が確実に出るフォントスタック。SVGは閲覧者の環境で描画されるため、
 * ここで指定できるのはあくまで優先順位。
 */
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', 'Segoe UI', 'Yu Gothic UI', sans-serif";

/**
 * 表示は日本語向けなので日本時間に固定する。実行環境のローカル時刻に任せると、
 * UTC で動く GitHub Actions では 0〜9 時（JST）の生成が前日の日付になる。
 */
const DATE_FORMAT_JST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** SVGのタイトル等に使う日付表記（YYYY-MM-DD、日本時間）。 */
export function formatDateJa(date: Date): string {
  return DATE_FORMAT_JST.format(date);
}

const DATETIME_FORMAT_JST = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * 「10/16 21:04」のような日時（日本時間）。静的モードの「最後に聴いた」時刻に使う。
 * 静的な生成物は数時間おきにしか作り直されないので、生成時刻を基準にした
 * 「約1時間前」を焼き込むと、閲覧時には実際より新しく見えてしまう。
 */
export function formatDateTimeJa(date: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    DATETIME_FORMAT_JST.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  return `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}
