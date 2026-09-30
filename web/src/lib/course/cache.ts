import { createHash } from "node:crypto";

/** TMAP·고도 응답 캐시. 서버리스는 인스턴스가 자주 바뀌므로 운영에서는 영속 저장소(Supabase)로 교체한다 */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const MAX_ENTRIES = 500;

/** 임시 구현: 프로세스 메모리. 개발·단일 인스턴스에서만 효과가 있다 */
export class MemoryCache implements CacheStore {
  private map = new Map<string, unknown>();

  async get<T>(key: string) {
    return this.map.get(key) as T | undefined;
  }

  async set(key: string, value: unknown) {
    if (this.map.size >= MAX_ENTRIES) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, value);
  }
}

export const cacheKey = (raw: string) => createHash("sha256").update(raw).digest("hex").slice(0, 24);

export async function cached<T>(store: CacheStore, raw: string, fetcher: () => Promise<T>): Promise<T> {
  const key = cacheKey(raw);
  const hit = await store.get<T>(key);
  if (hit !== undefined) return hit;
  const data = await fetcher();
  await store.set(key, data);
  return data;
}
