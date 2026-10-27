/**
 * CORS_ORIGIN の解釈。カンマ区切りで複数のオリジンを書ける。
 * 未設定・空は '*'（ローカル開発の既定。本番では埋め込み先に限ることを勧める）。
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  return origins.length > 0 ? origins : ['*'];
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
