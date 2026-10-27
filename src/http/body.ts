/**
 * 使わない fetch の応答の本文を捨てる。
 *
 * Node の fetch（undici）は、本文を読まずに捨てた応答の接続を GC まで解放しない。
 * 再試行や失敗が続くと接続が溜まり、遅延や停止につながる。
 * https://github.com/nodejs/undici#garbage-collection
 */
export async function discardBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}
