import type { Context } from 'hono';
import { accepts } from 'hono/accepts';
import yaml from 'js-yaml';
import {
  SpotifyApiError,
  SpotifyAuthError,
  SpotifyRateLimitError,
  SpotifyTimeoutError,
} from '../spotify/client.js';

function wantsYaml(c: Context): boolean {
  if (c.req.query('format') === 'yaml') return true;
  // 品質値を見る（`application/yaml;q=0` は「受け付けない」）。ヘッダー無しや */* は JSON
  const type = accepts(c, {
    header: 'Accept',
    supports: ['application/json', 'application/yaml', 'text/yaml'],
    default: 'application/json',
  });
  return type !== 'application/json';
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
    // refresh_token の失効か Client ID / Secret の誤りかはログで見分ける
    console.error('[spotify]', err.message);
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
  // Spotify が時間内に応答しなかった。上流の時間切れなので 504。
  if (err instanceof SpotifyTimeoutError) {
    console.error('[spotify]', err.message);
    return c.json({ error: 'Spotify API timed out' }, 504);
  }

  if (err instanceof SpotifyApiError) {
    console.error('[spotify]', err.message);
    return c.json({ error: 'Spotify API request failed', spotify_status: err.status }, 502);
  }

  console.error('[error]', err);
  return c.json({ error: 'Internal server error' }, 500);
}
