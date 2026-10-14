/**
 * 外部 HTTP 呼び出しのタイムアウト。
 *
 * 応答を返さないまま接続を保持されると、/badge.svg や /embed はその間ずっと待ち、
 * README の画像は camo プロキシに打ち切られて壊れる。進行中の取得は共有されるので
 * （collectNowPlaying）、ぶら下がった1本に後続のリクエストもすべて巻き込まれる。
 * 静的モードでも Actions のジョブが上限まで止まり続ける。
 *
 * LLM のタイムアウトは src/llm/client.ts が持つ（再試行の判断と一体のため）。
 */

/** Spotify Web API とトークン更新。 */
export const SPOTIFY_TIMEOUT_MS = 10_000;

/** ジャケ写の取得。失敗してもプレースホルダを描くだけなので短めにする。 */
export const IMAGE_TIMEOUT_MS = 5_000;

export class SpotifyTimeoutError extends Error {
  constructor(target: string, timeoutMs: number) {
    // `/artists?ids=...` は長いので畳む（SpotifyApiError と同じ扱い）
    const shown = target.length > 80 ? `${target.slice(0, 80)}…` : target;
    super(`Spotify が ${timeoutMs / 1000} 秒以内に応答しませんでした: ${shown}`);
    this.name = 'SpotifyTimeoutError';
  }
}

/** `fetch` にタイムアウトを付ける。時間切れは SpotifyTimeoutError にする。 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  target: string
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new SpotifyTimeoutError(target, timeoutMs);
    }
    throw err;
  }
}
