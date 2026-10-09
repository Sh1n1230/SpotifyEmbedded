import type { Context } from 'hono';
import yaml from 'js-yaml';
import { SpotifyApiError, SpotifyAuthError, SpotifyRateLimitError } from '../spotify/client.js';

function wantsYaml(c: Context): boolean {
  if (c.req.query('format') === 'yaml') return true;
  const accept = c.req.header('accept') ?? '';
  return accept.includes('application/yaml') || accept.includes('text/yaml');
}

/** JSON / YAML のコンテンツネゴシエーション。スキーマはどちらも同じ。 */
export function sendFormatted(c: Context, data: unknown): Response {
  // 同じ URL で Accept により形式が変わるので、共有キャッシュに混ぜさせない
  c.header('Vary', 'Accept');
  if (wantsYaml(c)) {
    return c.body(yaml.dump(data, { lineWidth: 120 }), 200, {
      'Content-Type': 'application/yaml; charset=utf-8',
    });
  }
  return c.json(data);
}

export function handleError(err: unknown, c: Context): Response {
  if (err instanceof SpotifyAuthError) {
    return c.json(
      {
        error: 'Spotify authentication failed. Re-run `npm run setup` to get a new refresh_token.',
      },
      502
    );
  }

  if (err instanceof SpotifyRateLimitError) {
    c.header('Retry-After', String(err.retryAfter));
    return c.json({ error: 'Spotify rate limit exceeded', retry_after: err.retryAfter }, 429);
  }

  // Spotify 由来の失敗は、こちらのバグではなく相手側の応答なので 502 で返し、
  // ステータス（403 など）だけ伝える。本文の詳細はサーバーのログにだけ出す
  // （外部 API の応答本文を公開エンドポイントにそのまま流さない）。
  if (err instanceof SpotifyApiError) {
    console.error('[spotify]', err.message);
    return c.json({ error: 'Spotify API request failed', spotify_status: err.status }, 502);
  }

  console.error('[error]', err);
  return c.json({ error: 'Internal server error' }, 500);
}
