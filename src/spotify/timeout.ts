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

/**
 * Spotify に接続できなかった（DNS・接続拒否・TLS など）。相手側に届かなかったので、こちらのバグ（500）ではなく 502。
 * 応答本文の読み取りの途中で接続が切れた場合も含む。
 */
export class SpotifyNetworkError extends Error {
  target: string;
  constructor(target: string, cause: unknown) {
    const shown = target.length > 80 ? `${target.slice(0, 80)}…` : target;
    const code = causeCode(cause);
    super(`Spotify に接続できませんでした: ${shown}${code ? ` (${code})` : ''}`, { cause });
    this.name = 'SpotifyNetworkError';
    this.target = target;
  }
}

/** undici の `TypeError: fetch failed` は、原因（ENOTFOUND など）を cause に持つ。 */
function causeCode(cause: unknown): string {
  const inner = cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause;
  if (inner && typeof inner === 'object' && 'code' in inner && typeof inner.code === 'string') {
    return inner.code;
  }
  return inner instanceof Error ? inner.message : '';
}

/** 時間切れ（TimeoutError）を SpotifyTimeoutError に、それ以外の通信の失敗を SpotifyNetworkError にする。 */
function toSpotifyError(err: unknown, target: string, timeoutMs: number): unknown {
  if (err instanceof Error && err.name === 'TimeoutError') return new SpotifyTimeoutError(target, timeoutMs);
  // 呼び出し側の中断（AbortError）など、通信の失敗ではないものはそのまま
  if (err instanceof TypeError || (err instanceof Error && 'code' in err)) {
    return new SpotifyNetworkError(target, err);
  }
  return err;
}

/**
 * 応答の本文を文字列として読む。`fetch` のタイムアウトは本文の読み取りにも効くため、
 * 読み取りの途中の時間切れも SpotifyTimeoutError にする（そのままだと 500 になる）。
 */
export async function readBodyText(res: Response, target: string, timeoutMs: number): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    throw toSpotifyError(err, target, timeoutMs);
  }
}

/** `fetch` にタイムアウトを付ける。時間切れは SpotifyTimeoutError、接続の失敗は SpotifyNetworkError にする。 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  target: string
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw toSpotifyError(err, target, timeoutMs);
  }
}
