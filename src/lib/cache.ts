// Sunucu taraflı caching katmanı: `REDIS_URL` tanımlıysa gerçek bir Redis
// instance'ına bağlanır (ioredis), tanımlı değilse veya bağlantı başarısız
// olursa otomatik olarak bellek-içi (in-process) bir fallback'e düşer.
//
// Mimari karar (ROADMAP Sprint 3.2 madde 2): rate-limit.ts/scheduled-sync.ts
// gibi diğer "altyapı eklentisi" özelliklerle aynı desen — caching bir
// GÜVENLİK özelliği değil, SADECE performans katmanıdır; bu yüzden
// CRON_SECRET/SSO gibi "tanımlı değilse devre dışı" yaklaşımı burada
// YANLIŞ olurdu (performans kazancından mahrum kalmak güvenlik riski
// değil, sadece eksik bir optimizasyondur). Bellek-içi fallback, tek
// instance/sunucu kurulumlarında (ki bu projenin varsayılan dağıtım
// şekli — bkz. docker-compose.yml tek `app` servisi) Redis'siz de
// gerçek bir performans kazancı sağlar; sadece coklu-instance/serverless
// dağıtımda paylaşımlı tutarlılık için gerçek Redis gerekir.
import { createHash } from "node:crypto";
import IORedis from "ioredis";

let redisClient: IORedis | null = null;
let redisInitAttempted = false;
let redisHealthy = false;

function getRedis(): IORedis | null {
  if (redisInitAttempted) return redisHealthy ? redisClient : null;
  redisInitAttempted = true;

  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;

  try {
    const client = new IORedis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // otomatik yeniden baglanma denemesi yok — basarisizlikta sessizce fallback'e dusulur
    });
    client.on("error", () => {
      redisHealthy = false;
    });
    client.on("ready", () => {
      redisHealthy = true;
    });
    redisClient = client;
    redisHealthy = true;
    return client;
  } catch {
    redisHealthy = false;
    return null;
  }
}

// --- Bellek-ici fallback ---
type MemEntry = { value: string; expiresAt: number };
const memStore = new Map<string, MemEntry>();
const MEM_CLEANUP_INTERVAL_MS = 60 * 1000;
let lastMemCleanup = Date.now();

function memCleanup(now: number) {
  if (now - lastMemCleanup < MEM_CLEANUP_INTERVAL_MS) return;
  lastMemCleanup = now;
  for (const [key, entry] of memStore) {
    if (entry.expiresAt <= now) memStore.delete(key);
  }
}

async function memGet(key: string): Promise<string | null> {
  const now = Date.now();
  memCleanup(now);
  const entry = memStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    memStore.delete(key);
    return null;
  }
  return entry.value;
}

async function memSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function memDel(prefix: string): Promise<void> {
  for (const key of memStore.keys()) {
    if (key.startsWith(prefix)) memStore.delete(key);
  }
}

// --- Genel API ---

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  try {
    const raw = redis ? await redis.get(key) : await memGet(key);
    return raw != null ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const json = JSON.stringify(value);
  const redis = getRedis();
  try {
    if (redis) await redis.set(key, json, "EX", ttlSeconds);
    else await memSet(key, json, ttlSeconds);
  } catch {
    // Redis anlik erisilemez olabilir (ag kesintisi vb.) — cache sadece bir
    // optimizasyon oldugundan, yazma basarisiz olursa sessizce yoksayilir
    // (fonksiyonel dogruluk cache'siz calismaya devam eder).
  }
}

// Verilen prefix ile BASLAYAN tum anahtarlari siler (model/tenant bazli
// toplu invalidation icin — orn. "pivot:5:" prefix'i modelId=5'in tum
// pivot sonuclarini kapsar).
export async function cacheDeleteByPrefix(prefix: string): Promise<void> {
  const redis = getRedis();
  try {
    if (redis) {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) await redis.del(...keys);
    } else {
      await memDel(prefix);
    }
  } catch {
    // bkz. yukaridaki not — invalidation basarisiz olursa en kotu ihtimalle
    // TTL dolana kadar bayat veri donebilir, veri bozulmasi olmaz.
  }
}

// Bir fonksiyonun sonucunu cache'ler: cache'te varsa onu doner, yoksa `fn`'i
// calistirip sonucu `ttlSeconds` sureyle cache'ler. `fn` deger olarak
// null/undefined DONEMEZ (cache miss ile ayirt edilemez) — bu tasarim
// gereği, sorgu sonuclarimiz (QueryResult/pivot tuples) her zaman bir
// nesne/dizi oldugundan bu bir sinirlama yaratmiyor.
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => T | Promise<T>
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit != null) return hit;
  const value = await fn();
  if (value != null) await cacheSet(key, value, ttlSeconds);
  return value;
}

// Sorgu parametrelerinden (filtre nesneleri, pagination vb.) deterministik,
// sabit uzunlukta bir cache anahtari parcasi uretir. JSON.stringify key
// sirasina bagli oldugundan (orn. {a:1,b:2} vs {b:2,a:1} farkli string
// uretir) once anahtarlar SIRALANIR — ayni mantiksal filtre her zaman
// ayni hash'e cozulur.
export function hashCacheParams(params: unknown): string {
  const normalized = JSON.stringify(params, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
  return createHash("sha1").update(normalized).digest("hex");
}

// Test/teshis amacli: bellek-ici store'u ve Redis init durumunu sifirlar.
export function __resetCacheForTests(): void {
  memStore.clear();
  redisClient = null;
  redisInitAttempted = false;
  redisHealthy = false;
}
