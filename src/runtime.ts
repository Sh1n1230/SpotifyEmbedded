/**
 * 実行環境ごとの違いのうち、ルートより下の層（取得・トークン更新）が知る必要のあるもの。
 * エントリ（src/worker.ts）が設定し、既定は Node の常駐サーバーの動作。
 *
 * 進行中の取得の共有: Node では、同時に来たリクエストは進行中の取得（now-playing・トークン更新）の Promise を
 * 待って同じ結果を使う。Cloudflare Workers では、あるリクエストの中で作った Promise を別のリクエストが待つと、
 * 作った側が先に終わった・打ち切られたときに待っている側の継続が止まることがある
 * （"A promise was resolved or rejected from a different request context"）。そのため Workers では
 * Promise を共有せず、値のキャッシュ（nowPlayingCache・アクセストークン）だけを共有する。
 * https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#do-not-store-request-scoped-state-in-global-scope
 */
let shareInFlightWork = true;

export function setShareInFlightWork(share: boolean): void {
  shareInFlightWork = share;
}

export function sharesInFlightWork(): boolean {
  return shareInFlightWork;
}
