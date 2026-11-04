/**
 * CORS_ORIGIN の解釈。カンマ区切りで複数のオリジンを書ける。
 * 未設定・空は '*'（ローカル開発の既定。本番では埋め込み先に限ることを勧める）。
 *
 * ブラウザの Origin ヘッダーは「スキーム://ホスト[:ポート]」の形なので、各値もその形（URL の origin）に
 * そろえる。末尾のスラッシュは黙って取り除き、パス付き・スキームの無い値など、オリジンとして読めない値は
 * 使わずに警告する（そのまま使うと、どのオリジンとも一致せず CORS が黙って効かなくなる）。
 * '*' と個別のオリジンが混ざっていたら、安全側に倒して '*' を使わない（個別のオリジンだけにする）。
 */
export interface CorsOriginSettings {
  origins: string[];
  /** 設定の誤り。Node は起動時、Workers は isolate ごとに一度だけ表示する */
  problems: string[];
}

export function analyzeCorsOrigins(raw: string | undefined): CorsOriginSettings {
  const values = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  if (values.length === 0) return { origins: ['*'], problems: [] };

  const problems: string[] = [];
  const origins: string[] = [];
  for (const value of values) {
    if (value === '*') continue;
    const origin = toOrigin(value);
    if (origin) {
      if (!origins.includes(origin)) origins.push(origin);
    } else {
      problems.push(
        `CORS_ORIGIN の ${value} はオリジンとして読めないため使いません。https://a.example のように、スキームとホスト（とポート）だけを書いてください。`
      );
    }
  }
  if (values.includes('*')) {
    if (origins.length === 0 && problems.length === 0) return { origins: ['*'], problems: [] };
    problems.push('CORS_ORIGIN の * は、ほかのオリジンと一緒には使えないため無視します（書いた個別のオリジンだけを許可します）。');
  }
  return { origins, problems };
}

/** http(s) の URL の origin。パス・クエリ・フラグメント・認証情報があれば null（末尾の / だけは許す）。 */
function toOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  return url.origin;
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  return analyzeCorsOrigins(raw).origins;
}

/**
 * どのサイトからでも叩ける設定なら、その旨の警告文を返す。他人のサイトに埋め込まれると、
 * 自分の Spotify の枠と LLM の費用（ムード文の生成）を使われる。
 */
export function openCorsWarning(origins: string[]): string | null {
  if (!origins.includes('*')) return null;
  return (
    'CORS_ORIGIN が未設定（*）のため、どのサイトからでも API を呼べます。' +
    '埋め込み先のオリジン（例: https://yoursite.example）に限ってください。カンマ区切りで複数書けます。'
  );
}
