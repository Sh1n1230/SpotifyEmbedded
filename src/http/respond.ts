import type { Context } from 'hono';
import { accepts } from 'hono/accepts';
import { HTTPException } from 'hono/http-exception';
import { toYaml } from '../core/yaml.js';
import { MissingConfigError } from '../authStore.js';
import {
  SpotifyApiError,
  SpotifyAuthError,
  SpotifyNetworkError,
  SpotifyRateLimitError,
  SpotifyTimeoutError,
} from '../spotify/client.js';

/** /api/now-playing の成功応答の Cache-Control */
export const LIVE_JSON_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

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
  // 途中の CDN・ブラウザに鮮度を推測させない。保存はしてよいが、使う前に必ず問い合わせる
  // （サーバー側の nowPlayingCache が間引くので、毎回 Spotify を呼ぶわけではない）
  c.header('Cache-Control', LIVE_JSON_CACHE_CONTROL);
  if (wantsYaml(c)) {
    return c.body(toYaml(data), 200, {
      'Content-Type': 'application/yaml; charset=utf-8',
    });
  }
  return c.json(data);
}

/**
 * エラー応答の `code`。文（error）は人向けで変わりうるので、利用側はこちらで分岐する。一覧は README にもある。
 * /badge.svg・/embed は JSON を返せないので、X-Spotify-Embedded-Error に `rate_limited`（= rate_limited）か
 * `spotify_unavailable`（= それ以外のすべて）を入れる。
 */
export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'rate_limited'
  | 'not_configured'
  | 'spotify_auth_failed'
  | 'spotify_rate_limited'
  | 'spotify_timeout'
  | 'spotify_unreachable'
  | 'spotify_error'
  | 'internal_error';

type ErrorStatus = 400 | 404 | 429 | 500 | 502 | 503 | 504;

/** エラーの JSON。途中の CDN やブラウザに残さない（直った後も古い失敗が返らないように）。 */
export function sendError(
  c: Context,
  status: ErrorStatus,
  code: ErrorCode,
  error: string,
  extra: Record<string, unknown> = {}
): Response {
  c.header('Cache-Control', 'no-store');
  return c.json({ error, code, ...extra }, status);
}

export function handleError(err: unknown, c: Context): Response {
  // ルートが意図して返した HTTP のエラー（400 など）は、そのステータスと理由で返す（こちらのバグではないのでログに出さない）
  if (err instanceof HTTPException) {
    c.header('Cache-Control', 'no-store');
    const code: ErrorCode = err.status === 404 ? 'not_found' : err.status >= 500 ? 'internal_error' : 'bad_request';
    return c.json({ error: err.message || 'Request failed', code }, err.status);
  }

  // 必須の設定（Secrets）が無い。運用者が直すもので、こちらのバグ（500）ではない。
  // 環境変数名は公開エンドポイントに出さず、ログにだけ出す
  if (err instanceof MissingConfigError) {
    console.error('[config]', err.message);
    return sendError(c, 503, 'not_configured', 'Server is not configured. See server logs.');
  }

  if (err instanceof SpotifyAuthError) {
    // refresh_token の失効か Client ID / Secret の誤りかはログで見分ける。
    // 覚えていた失敗を返しただけのとき（repeated）は、リクエストのたびに同じ案内を出さない
    if (!err.repeated) console.error('[spotify]', err.message);
    return sendError(
      c,
      502,
      'spotify_auth_failed',
      'Spotify authentication failed. Re-run `npm run setup` to get a new refresh_token.'
    );
  }

  // Spotify の枠はこのサーバー（Client ID）全体のもので、叩いた利用者が多すぎたわけではない。
  // 429（そのクライアントの送りすぎ。RFC 6585 §4）ではなく、上流の都合で一時的に応えられない 503 で返す
  if (err instanceof SpotifyRateLimitError) {
    c.header('Retry-After', String(err.retryAfter));
    return sendError(c, 503, 'spotify_rate_limited', 'Spotify rate limit exceeded', { retry_after: err.retryAfter });
  }

  // Spotify が時間内に応答しなかった。上流の時間切れなので 504。
  if (err instanceof SpotifyTimeoutError) {
    console.error('[spotify]', err.message);
    return sendError(c, 504, 'spotify_timeout', 'Spotify API timed out');
  }

  // Spotify に届かなかった（DNS・接続拒否・TLS など）。上流の問題なので 502。原因はログにだけ出す
  if (err instanceof SpotifyNetworkError) {
    console.error('[spotify]', err.message);
    return sendError(c, 502, 'spotify_unreachable', 'Could not reach Spotify');
  }

  // Spotify 由来の失敗は、こちらのバグではなく相手側の応答なので 502 で返し、
  // ステータス（403 など）だけ伝える。本文の詳細はサーバーのログにだけ出す
  // （外部 API の応答本文を公開エンドポイントにそのまま流さない）。
  if (err instanceof SpotifyApiError) {
    console.error('[spotify]', err.message);
    return sendError(c, 502, 'spotify_error', 'Spotify API request failed', { spotify_status: err.status });
  }

  console.error('[error]', err);
  return sendError(c, 500, 'internal_error', 'Internal server error');
}
