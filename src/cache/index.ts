/**
 * プロセス（Workers では isolate）内のメモリキャッシュ。
 *
 * node-cache は生成時に setInterval で掃除用タイマーを張る。Workers は
 * グローバルスコープでのタイマーを許さないため、期限切れは読み出し時に
 * 判定するだけの最小実装にしている。
 */
export class TtlCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  /**
   * @param ttlSeconds 0 なら期限なし
   * @param maxKeys 満杯のときの set は、期限切れを掃除しても空かなければ、最も長く読まれていないものを捨てて入れる（LRU）。
   *   新しい値を捨てて古い値を残すと、満杯の後に聴き始めた曲のムード文が保存されず、毎回 LLM で作り直すことになるため
   */
  constructor(
    private readonly ttlSeconds: number,
    private readonly maxKeys = Infinity
  ) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Map は挿入順を保つので、読むたびに入れ直すと、先頭が最も長く読まれていないものになる
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) {
      this.evictExpired();
      if (this.entries.size >= this.maxKeys) {
        const leastRecentlyUsed = this.entries.keys().next().value;
        if (leastRecentlyUsed !== undefined) this.entries.delete(leastRecentlyUsed);
      }
    }
    const expiresAt = this.ttlSeconds > 0 ? Date.now() + this.ttlSeconds * 1000 : Infinity;
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

export const nowPlayingCache = new TtlCache(30);
// Keyed by trackId. 満杯なら最も長く読まれていない曲のものを捨てて入れる。
export const moodCache = new TtlCache(86400, 200);
// Keyed by image URL. ライブSVGはリクエストのたびにジャケ写を data URI 化
// するため、画像バイト列を使い回す。
export const artCache = new TtlCache(86400, 100);

/**
 * LLM の生成結果を isolate の寿命より長く持つための外部ストア。
 *
 * Workers ではメモリが頻繁に捨てられ、そのたびに同じ曲のムード文を
 * LLM で作り直すことになる。Workers では KV を、Node の常駐サーバーでは
 * 何も設定しない（メモリだけで足りる）。
 */
export interface DurableStore {
  get<T>(key: string): Promise<T | null>;
  /** ttlSeconds を省略すると期限なし。 */
  put(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
}

let durableStore: DurableStore | null = null;

export function setDurableStore(store: DurableStore | null): void {
  durableStore = store;
}

export function getDurableStore(): DurableStore | null {
  return durableStore;
}
