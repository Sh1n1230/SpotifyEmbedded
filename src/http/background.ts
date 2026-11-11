import type { Context } from 'hono';

/**
 * ライブAPIがムード文の生成を待つ上限。超えたら mood: null で応答し、生成は続けて次の取得で載せる。
 * /badge.svg は GitHub の camo の時間制限の中で返す必要があり、Spotify の呼び出し（最大 10 秒）の後に
 * LLM（最大 30 秒）まで待つと画像が壊れる。
 */
export const LIVE_MOOD_DEADLINE_MS = 5000;

/**
 * 応答の後に終わればよい処理を預ける先。Workers ではリクエストの ctx.waitUntil（応答を返した後も処理を続けさせる）。
 * Node には無いので undefined を返す（呼び出し側は、書き込みを待つ・生成をそのまま走らせておく）。
 */
export function deferOf(c: Context): ((work: Promise<unknown>) => void) | undefined {
  let ctx: { waitUntil?: unknown };
  try {
    // Hono は ExecutionContext が無いと、参照した時点で投げる
    ctx = c.executionCtx;
  } catch {
    return undefined;
  }
  if (typeof ctx.waitUntil !== 'function') return undefined;
  const waitUntil = ctx.waitUntil.bind(ctx) as (work: Promise<unknown>) => void;
  return (work) => waitUntil(work);
}

/** ライブAPIのルートが collectNowPlaying に渡す、ムード文の待ち方。 */
export function liveMoodOptions(c: Context): { moodDeadlineMs: number; defer?: (work: Promise<unknown>) => void } {
  const defer = deferOf(c);
  return defer ? { moodDeadlineMs: LIVE_MOOD_DEADLINE_MS, defer } : { moodDeadlineMs: LIVE_MOOD_DEADLINE_MS };
}
