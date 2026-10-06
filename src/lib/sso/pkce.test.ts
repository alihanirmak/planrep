import { describe, it, expect } from "vitest";
import { generateCodeVerifier, generateCodeChallenge, generateState, generateNonce } from "./pkce";
import { createHash } from "node:crypto";

describe("generateCodeVerifier", () => {
  it("base64url karakter setinde, yeterince uzun bir string uretir", () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  it("her cagrida farkli bir deger uretir", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe("generateCodeChallenge", () => {
  it("RFC 7636 S256: BASE64URL(SHA256(verifier))", () => {
    const verifier = "test-verifier-12345";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(generateCodeChallenge(verifier)).toBe(expected);
  });

  it("ayni verifier icin deterministiktir", () => {
    const verifier = generateCodeVerifier();
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
  });

  it("farkli verifier'lar farkli challenge uretir", () => {
    const a = generateCodeChallenge("a");
    const b = generateCodeChallenge("b");
    expect(a).not.toBe(b);
  });
});

describe("generateState / generateNonce", () => {
  it("her ikisi de benzersiz, base64url degerler uretir", () => {
    const s1 = generateState();
    const s2 = generateState();
    const n1 = generateNonce();
    expect(s1).not.toBe(s2);
    expect(n1).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
