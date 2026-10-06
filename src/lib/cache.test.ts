import { describe, it, expect, beforeEach } from "vitest";

// REDIS_URL bu test surecinde HICBIR ZAMAN tanimlanmaz (CI/dev ortaminda
// gercek bir Redis instance'i olmayabilir) — bu yuzden testler kasitli
// olarak sadece bellek-ici fallback yolunu kapsar. getRedis() bu durumda
// null doner ve tum cacheGet/cacheSet/cacheDeleteByPrefix cagrilari
// otomatik olarak memStore'a duser (bkz. lib/cache.ts).
let cache: typeof import("./cache");

beforeEach(async () => {
  delete process.env.REDIS_URL;
  cache = await import("./cache");
  cache.__resetCacheForTests();
});

describe("cacheGet / cacheSet (bellek-ici fallback)", () => {
  it("set edilen deger get ile geri okunabilir", async () => {
    await cache.cacheSet("k1", { a: 1, b: [1, 2, 3] }, 60);
    expect(await cache.cacheGet("k1")).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("var olmayan anahtar icin null doner", async () => {
    expect(await cache.cacheGet("no-such-key")).toBeNull();
  });

  it("TTL dolduktan sonra deger artik donmez", async () => {
    await cache.cacheSet("expiring", "value", -1); // zaten gecmis bir TTL
    expect(await cache.cacheGet("expiring")).toBeNull();
  });
});

describe("cacheDeleteByPrefix", () => {
  it("sadece verilen prefix ile baslayan anahtarlari siler", async () => {
    await cache.cacheSet("pivot:v1:5:a", "x", 60);
    await cache.cacheSet("pivot:v1:5:b", "y", 60);
    await cache.cacheSet("pivot:v1:6:a", "z", 60);
    await cache.cacheDeleteByPrefix("pivot:v1:5:");
    expect(await cache.cacheGet("pivot:v1:5:a")).toBeNull();
    expect(await cache.cacheGet("pivot:v1:5:b")).toBeNull();
    expect(await cache.cacheGet("pivot:v1:6:a")).toBe("z");
  });

  it("eslesen anahtar yoksa sessizce hicbir sey yapmaz", async () => {
    await expect(cache.cacheDeleteByPrefix("no:such:prefix:")).resolves.toBeUndefined();
  });
});

describe("cached", () => {
  it("ilk cagrida fn calistirilir, ikinci cagrida cache'ten doner", async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      return { value: 42 };
    };
    const first = await cache.cached("fn-key", 60, fn);
    const second = await cache.cached("fn-key", 60, fn);
    expect(first).toEqual({ value: 42 });
    expect(second).toEqual({ value: 42 });
    expect(callCount).toBe(1);
  });

  it("async fn de desteklenir", async () => {
    const result = await cache.cached("async-key", 60, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
  });

  it("farkli anahtarlar ayri ayri cache'lenir", async () => {
    await cache.cached("key-a", 60, () => "A");
    await cache.cached("key-b", 60, () => "B");
    expect(await cache.cacheGet("key-a")).toBe("A");
    expect(await cache.cacheGet("key-b")).toBe("B");
  });
});

describe("hashCacheParams", () => {
  it("ayni mantiksal parametreler (anahtar sirasi farkli) ayni hash'i uretir", () => {
    const a = cache.hashCacheParams({ modelId: 1, filters: { CC: ["A"], VER: ["B"] } });
    const b = cache.hashCacheParams({ filters: { VER: ["B"], CC: ["A"] }, modelId: 1 });
    expect(a).toBe(b);
  });

  it("farkli parametreler farkli hash uretir", () => {
    const a = cache.hashCacheParams({ modelId: 1 });
    const b = cache.hashCacheParams({ modelId: 2 });
    expect(a).not.toBe(b);
  });

  it("deterministik — ayni girdi her zaman ayni cikti", () => {
    const params = { modelId: 7, rows: ["A", "B"], page: 2 };
    expect(cache.hashCacheParams(params)).toBe(cache.hashCacheParams(params));
  });

  it("hex formatinda sabit uzunlukta bir string doner", () => {
    const hash = cache.hashCacheParams({ anything: "goes here" });
    expect(hash).toMatch(/^[0-9a-f]{40}$/); // sha1 hex digest
  });
});
