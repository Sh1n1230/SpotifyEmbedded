/**
 * プロセス（Workers では isolate）内のメモリキャッシュ。
 *
 * node-cache は生成時に setInterval で掃除用タイマーを張る。Workers は
 * グローバルスコープでのタイマーを許さないため、期限切れは読み出し時に
 * 判定するだけの最小実装にしている。
 */
import { config } from '../config.js';
import type { MoodResult, NowPlayingResponse } from '../types/index.js';
export class TtlCache<V = unknown> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  /**
   * @param ttlSeconds 0 なら期限なし。関数なら set のたびに読む（Workers では環境変数がリクエスト時に解決されるため）
   * @param maxKeys 満杯のときの set は、期限切れを掃除しても空かなければ、最も長く読まれていないものを捨てて入れる（LRU）。
   *   新しい値を捨てて古い値を残すと、満杯の後に聴き始めた曲のムード文が保存されず、毎回 LLM で作り直すことになるため
   */
  constructor(
    private readonly ttlSeconds: number | (() => number),
    private readonly maxKeys = Infinity
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Map は挿入順を保つので、読むたびに入れ直すと、先頭が最も長く読まれていないものになる
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) {
      this.evictExpired();
      if (this.entries.size >= this.maxKeys) {
        const leastRecentlyUsed = this.entries.keys().next().value;
        if (leastRecentlyUsed !== undefined) this.entries.delete(leastRecentlyUsed);
      }
    }
    const ttlSeconds = typeof this.ttlSeconds === 'function' ? this.ttlSeconds() : this.ttlSeconds;
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Infinity;
    // 上書きのときも最後に回す（最も新しく使ったものにする）
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt });
  }

  flushAll(): void {
    this.entries.clear();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

// 既定は 30 秒。NOW_PLAYING_CACHE_SECONDS で変えられる（src/config.ts）
export const nowPlayingCache = new TtlCache<NowPlayingResponse>(() => config.server.nowPlayingCacheSeconds);
// Keyed by trackId. 満杯なら最も長く読まれていない曲のものを捨てて入れる。
export const moodCache = new TtlCache<MoodResult>(86400, 200);
// Keyed by image URL. ライブSVGはリクエストのたびにジャケ写を data URI 化
// するため、画像バイト列を使い回す。
// 1件は最大 512KB の画像の base64（約 700KB）なので、最悪でも 20 × 700KB ≒ 14MB（Workers の上限 128MB に対して十分小さい）。
// 同時に表示するのは1曲なので、20件あれば足りる。
export const artCache = new TtlCache<string>(86400, 20);

/**
 * LLM の生成結果を isolate の寿命より長く持つための外部ストア。
 *
 * Workers ではメモリが頻繁に捨てられ、そのたびに同じ曲のムード文を
 * LLM で作り直すことになる。Workers では KV を、Node の常駐サーバーでは
 * 何も設定しない（メモリだけで足りる）。
 */
export interface DurableStore {
  /** 外部ストアの中身は古い版が書いたものかもしれないので、形は呼び出し側が確かめる。 */
  get(key: string): Promise<unknown>;
  /** ttlSeconds を省略すると期限なし。 */
  /** @param ttlSeconds Workers KV の expirationTtl は60秒未満を拒むので、Workers の実装では60秒に切り上げる */
  put(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
}

let durableStore: DurableStore | null = null;

export function setDurableStore(store: DurableStore | null): void {
  durableStore = store;
}

export function getDurableStore(): DurableStore | null {
  return durableStore;
}
