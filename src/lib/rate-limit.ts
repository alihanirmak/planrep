// Basit, bellek-ici token-bucket tarzi rate limiter. Tek instance/sunucu
// kurulumlari icin yeterlidir; coklu instance/serverless dagitimda
// paylasimli bir store (orn. Redis) gerekir.
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Periyodik olarak suresi gecmis kayitlari temizle (bellek sizintisini onlemek icin)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

// `key`: istemciyi/uc noktayi tekillestiren tanimlayici (orn. "login:1.2.3.4")
// `limit`: pencere basina izin verilen istek sayisi
// `windowMs`: pencere suresi (ms)
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanup(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

export function clientIp(req: Request): string {
  const headers = req.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
