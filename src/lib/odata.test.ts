import { describe, it, expect } from "vitest";
import { parseODataFilter, buildODataEnvelope, parseTopSkip, DEFAULT_TOP, MAX_TOP } from "./odata";

describe("parseODataFilter", () => {
  it("bos/tanimsiz girdi icin bos filtre kumesi doner (ok=true)", () => {
    expect(parseODataFilter(null)).toEqual({ ok: true, filters: {} });
    expect(parseODataFilter(undefined)).toEqual({ ok: true, filters: {} });
    expect(parseODataFilter("")).toEqual({ ok: true, filters: {} });
    expect(parseODataFilter("   ")).toEqual({ ok: true, filters: {} });
  });

  it("tek bir 'alan eq değer' kosulunu dogru parse eder", () => {
    const result = parseODataFilter("CC eq 'CC100'");
    expect(result).toEqual({ ok: true, filters: { CC: ["CC100"] } });
  });

  it("virgulle ayrilmis birden fazla degeri (pragmatik IN genisletmesi) parse eder", () => {
    const result = parseODataFilter("CC eq 'CC100,CC200'");
    expect(result).toEqual({ ok: true, filters: { CC: ["CC100", "CC200"] } });
  });

  it("'and' ile birlestirilen birden fazla kosulu parse eder", () => {
    const result = parseODataFilter("CC eq 'CC100' and VERSION eq 'BUDGET'");
    expect(result).toEqual({ ok: true, filters: { CC: ["CC100"], VERSION: ["BUDGET"] } });
  });

  it("buyuk/kucuk harf duyarsiz 'and' ve alan adi normalize edilir", () => {
    const result = parseODataFilter("cc EQ 'CC100' AND version eq 'BUDGET'");
    expect(result).toEqual({ ok: true, filters: { CC: ["CC100"], VERSION: ["BUDGET"] } });
  });

  it("desteklenmeyen operator/sozdizimi icin ok=false ve hata mesaji doner", () => {
    const result = parseODataFilter("CC ne 'CC100'");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("CC ne 'CC100'");
  });

  it("tirnak icinde bos deger icin ok=false doner", () => {
    const result = parseODataFilter("CC eq ''");
    expect(result.ok).toBe(false);
  });
});

describe("buildODataEnvelope", () => {
  it("count verilmezse @odata.count alani olusturulmaz", () => {
    const env = buildODataEnvelope("http://x/metadata#M", [{ a: 1 }]);
    expect(env).toEqual({ "@odata.context": "http://x/metadata#M", value: [{ a: 1 }] });
  });

  it("count verilirse @odata.count alani eklenir", () => {
    const env = buildODataEnvelope("http://x/metadata#M", [{ a: 1 }], 42);
    expect(env).toEqual({ "@odata.context": "http://x/metadata#M", "@odata.count": 42, value: [{ a: 1 }] });
  });
});

describe("parseTopSkip", () => {
  it("hicbir parametre verilmezse varsayilan degerler kullanilir", () => {
    const result = parseTopSkip(new URLSearchParams());
    expect(result).toEqual({ top: DEFAULT_TOP, skip: 0 });
  });

  it("gecerli $top/$skip degerlerini okur", () => {
    const result = parseTopSkip(new URLSearchParams("$top=50&$skip=100"));
    expect(result).toEqual({ top: 50, skip: 100 });
  });

  it("$top, MAX_TOP'u asamaz", () => {
    const result = parseTopSkip(new URLSearchParams(`$top=${MAX_TOP + 5000}`));
    expect(result.top).toBe(MAX_TOP);
  });

  it("gecersiz (negatif/sayi olmayan) degerler varsayilana duser", () => {
    expect(parseTopSkip(new URLSearchParams("$top=-5&$skip=abc"))).toEqual({ top: DEFAULT_TOP, skip: 0 });
  });
});
