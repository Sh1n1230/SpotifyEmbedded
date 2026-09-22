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
   * @param maxKeys 満杯のときの set は throw する（node-cache と同じ挙動）
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
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) {
      this.evictExpired();
      if (this.entries.size >= this.maxKeys) throw new Error('Cache max keys amount exceeded');
    }
    const expiresAt = this.ttlSeconds > 0 ? Date.now() + this.ttlSeconds * 1000 : Infinity;
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
// Keyed by trackId. 満杯なら set が throw するので、呼び出し側は失敗を
// キャッシュミスとして扱う。
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
