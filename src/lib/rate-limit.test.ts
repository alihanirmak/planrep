import { describe, expect, it } from "vitest";
import { rateLimit, clientIp } from "./rate-limit";

describe("rateLimit", () => {
  it("ilk istege izin verir ve kalan sayiyi dogru hesaplar", () => {
    const key = `test:${Math.random()}`;
    const r = rateLimit(key, 3, 60_000);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("limit asildiginda sonraki istekleri reddeder", () => {
    const key = `test:${Math.random()}`;
    rateLimit(key, 2, 60_000);
    rateLimit(key, 2, 60_000);
    const third = rateLimit(key, 2, 60_000);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("farkli anahtarlar birbirinden bagimsiz sayilir", () => {
    const keyA = `test:a:${Math.random()}`;
    const keyB = `test:b:${Math.random()}`;
    rateLimit(keyA, 1, 60_000);
    const resultA = rateLimit(keyA, 1, 60_000);
    const resultB = rateLimit(keyB, 1, 60_000);
    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });

  it("pencere suresi dolduktan sonra sayac sifirlanir", () => {
    const key = `test:${Math.random()}`;
    const first = rateLimit(key, 1, 1);
    expect(first.allowed).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const second = rateLimit(key, 1, 1);
        expect(second.allowed).toBe(true);
        resolve();
      }, 5);
    });
  });
});

describe("clientIp", () => {
  it("x-forwarded-for basligindan ilk IP'yi alir", () => {
    const req = new Request("http://localhost/api/x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("x-forwarded-for yoksa x-real-ip kullanir", () => {
    const req = new Request("http://localhost/api/x", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("hic baslik yoksa unknown doner", () => {
    const req = new Request("http://localhost/api/x");
    expect(clientIp(req)).toBe("unknown");
  });
});
