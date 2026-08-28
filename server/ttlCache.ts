export type CacheMetadata = {
  hit: boolean;
  ageMs: number;
  expiresAt: number;
};

type CacheEntry<T> = {
  value: T;
  createdAt: number;
  expiresAt: number;
};

/** Small in-process TTL cache for read-heavy, recomputable dashboard payloads. */
export class TtlCache<T> {
  private entry: CacheEntry<T> | null = null;

  constructor(private readonly ttlMs: number) {}

  async get(loader: () => Promise<T>, now = Date.now()): Promise<{ value: T; cache: CacheMetadata }> {
    if (this.entry && this.entry.expiresAt > now) {
      return {
        value: this.entry.value,
        cache: { hit: true, ageMs: now - this.entry.createdAt, expiresAt: this.entry.expiresAt },
      };
    }
    const value = await loader();
    this.entry = { value, createdAt: now, expiresAt: now + this.ttlMs };
    return { value, cache: { hit: false, ageMs: 0, expiresAt: this.entry.expiresAt } };
  }

  clear() {
    this.entry = null;
  }
}
