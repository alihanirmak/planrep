import { describe, it, expect } from "vitest";
import { generateTotpSecret, generateTotp, verifyTotp, buildOtpAuthUri, generateBackupCodes } from "./totp";

describe("generateTotpSecret", () => {
  it("gecerli bir base32 string uretir", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThan(0);
  });

  it("her cagrida farkli bir secret uretir", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
  });
});

describe("generateTotp / verifyTotp", () => {
  it("uretilen kod kendisiyle dogrulanir", () => {
    const secret = generateTotpSecret();
    const token = generateTotp(secret);
    expect(token).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, token)).toBe(true);
  });

  it("yanlis kod dogrulanmaz", () => {
    const secret = generateTotpSecret();
    const token = generateTotp(secret);
    const wrong = token === "000000" ? "111111" : "000000";
    expect(verifyTotp(secret, wrong)).toBe(false);
  });

  it("farkli secret'larin kodlari (genelde) birbirini dogrulamaz", () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const tokenA = generateTotp(secretA);
    expect(verifyTotp(secretB, tokenA)).toBe(false);
  });

  it("bir onceki/sonraki zaman adiminin kodu da (window=1 ile) kabul edilir", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const prevStepToken = generateTotp(secret, {}, now - 30_000);
    expect(verifyTotp(secret, prevStepToken, {}, now)).toBe(true);
  });

  it("cok eski bir zaman adiminin kodu (window disinda) reddedilir", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const oldToken = generateTotp(secret, {}, now - 10 * 30_000);
    expect(verifyTotp(secret, oldToken, { window: 1 }, now)).toBe(false);
  });

  it("bosluklu kod girisini (kullanicilarin bazen 3 ayri grup halinde yazdigi) temizler", () => {
    const secret = generateTotpSecret();
    const token = generateTotp(secret);
    const spaced = `${token.slice(0, 3)} ${token.slice(3)}`;
    expect(verifyTotp(secret, spaced)).toBe(true);
  });

  it("yanlis uzunluktaki kod reddedilir", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "123")).toBe(false);
    expect(verifyTotp(secret, "1234567")).toBe(false);
  });

  it("rakam olmayan karakter iceren kod reddedilir", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "12345a")).toBe(false);
  });
});

describe("buildOtpAuthUri", () => {
  it("otpauth://totp/ ile baslayan gecerli bir URI uretir", () => {
    const secret = generateTotpSecret();
    const uri = buildOtpAuthUri(secret, "user@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("issuer=PlanRep");
  });

  it("ozel issuer parametresini kullanir", () => {
    const secret = generateTotpSecret();
    const uri = buildOtpAuthUri(secret, "user@example.com", "ÖzelMarka");
    expect(uri).toContain(encodeURIComponent("ÖzelMarka"));
  });
});

describe("generateBackupCodes", () => {
  it("varsayilan olarak 8 kod uretir, format XXXX-XXXX", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  it("istenen sayida kod uretebilir", () => {
    expect(generateBackupCodes(3)).toHaveLength(3);
  });

  it("uretilen kodlar birbirinden farklidir (pratikte)", () => {
    const codes = generateBackupCodes(8);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("karistirici karakterler (0/O, 1/I/L) alfabede yok", () => {
    const codes = generateBackupCodes(20);
    const joined = codes.join("");
    expect(joined).not.toMatch(/[01ILO]/);
  });
});
