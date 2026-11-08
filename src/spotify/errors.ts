/**
 * Spotify の応答の失敗を表すエラーと、Retry-After の解釈。
 *
 * client.ts（Spotify API）と auth.ts（トークン更新）の両方が使う。client.ts は auth.ts を import するので、
 * 循環しないよう、どちらにも依存しないこのファイルに置く。
 */

/** 401 / 429 以外の失敗。原因が分かるメッセージを添える。 */
export class SpotifyApiError extends Error {
  status: number;
  path: string;
  constructor(status: number, path: string, body: string) {
    super(describe(status, path, body));
    this.name = 'SpotifyApiError';
    this.status = status;
    this.path = path;
  }
}

function describe(status: number, rawPath: string, body: string): string {
  // `/artists?ids=...` は50件分のIDが並ぶ。ログに全部出しても読めないので畳む。
  const path = rawPath.length > 80 ? `${rawPath.slice(0, 80)}…` : rawPath;
  const detail = body.trim() ? ` ${body.trim().slice(0, 200)}` : '';
  if (status === 403) {
    return (
      `Spotify が ${path} を拒否しました (403)。` +
      'アプリに必要なスコープが無いか、2024年11月以降に作成されたアプリで' +
      `制限されているエンドポイントです。${detail}`
    );
  }
  if (status === 404) return `Spotify のエンドポイントが見つかりません: ${path} (404).${detail}`;
  return `Spotify API の呼び出しに失敗しました: ${path} (${status}).${detail}`;
}

export class SpotifyRateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super('Spotify rate limit exceeded');
    this.name = 'SpotifyRateLimitError';
    this.retryAfter = retryAfter;
  }
}

/** Retry-After の上限（秒）。極端な値（1e+21 など）を利用者にそのまま渡さない。 */
export const MAX_RETRY_AFTER_SECONDS = 3600;

/**
 * HTTP-date の3つの形式（RFC 9110 §5.6.7）。Date.parse は「1.5」のような値も日付として
 * 読んでしまうため、この形のときだけ日付として扱う。
 */
const HTTP_DATE_PATTERNS = [
  // IMF-fixdate: Sun, 06 Nov 1994 08:49:37 GMT
  /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  // rfc850-date: Sunday, 06-Nov-94 08:49:37 GMT
  /^[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT$/,
  // asctime-date: Sun Nov  6 08:49:37 1994
  /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/,
];

/**
 * 429 の Retry-After を秒に直す。形式は秒数か HTTP-date（RFC 9110 §10.2.3）。
 * 読めない値・ヘッダー無しは 1 秒（Retry-After: NaN のような不正な値を利用者に渡さない）。
 * 上限は MAX_RETRY_AFTER_SECONDS。
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  const raw = value?.trim() ?? '';
  if (/^\d+$/.test(raw)) return Math.min(Number(raw), MAX_RETRY_AFTER_SECONDS);
  if (HTTP_DATE_PATTERNS.some((pattern) => pattern.test(raw))) {
    // asctime-date は GMT だがタイムゾーンを書かないため、そのままでは実行環境の時刻として読まれる
    const at = Date.parse(raw.endsWith('GMT') ? raw : `${raw} GMT`);
    if (!Number.isNaN(at)) {
      return Math.min(Math.max(0, Math.ceil((at - now) / 1000)), MAX_RETRY_AFTER_SECONDS);
    }
  }
  return 1;
}
