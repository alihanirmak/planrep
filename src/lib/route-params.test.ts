import { describe, expect, it } from "vitest";
import { parseIdParam } from "./route-params";

describe("parseIdParam", () => {
  it("gecerli pozitif tam sayi dizgelerini kabul eder", () => {
    expect(parseIdParam("1")).toBe(1);
    expect(parseIdParam("42")).toBe(42);
    expect(parseIdParam("9007199254740991")).toBe(9007199254740991);
  });

  it("sifiri ve negatif sayilari reddeder", () => {
    expect(parseIdParam("0")).toBeNull();
    expect(parseIdParam("-1")).toBeNull();
  });

  it("sayi olmayan veya karisik dizgeleri reddeder", () => {
    expect(parseIdParam("abc")).toBeNull();
    expect(parseIdParam("1abc")).toBeNull();
    expect(parseIdParam("1.5")).toBeNull();
    expect(parseIdParam("1e10")).toBeNull();
    expect(parseIdParam(" 1")).toBeNull();
    expect(parseIdParam("")).toBeNull();
  });

  it("NaN/Infinity uretebilecek girdileri reddeder", () => {
    expect(parseIdParam("NaN")).toBeNull();
    expect(parseIdParam("Infinity")).toBeNull();
  });
});
