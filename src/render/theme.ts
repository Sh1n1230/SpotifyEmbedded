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

/** 「たった今」「約2時間前」のような相対時刻。静的モードの鮮度表示に使う。 */
export function relativeTimeJa(from: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `約${hours}時間前`;

  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

/** SVGのタイトル等に使う日付表記。 */
export function formatDateJa(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
