import { describe, it, expect } from "vitest";
import { compileFormula } from "./formula";

describe("compileFormula", () => {
  it("basit aritmetik ifadeleri hesaplar", () => {
    expect(compileFormula("1+2").run(() => undefined)).toBe(3);
    expect(compileFormula("10-4").run(() => undefined)).toBe(6);
    expect(compileFormula("3*4").run(() => undefined)).toBe(12);
    expect(compileFormula("10/2").run(() => undefined)).toBe(5);
  });

  it("islem onceligine ve parantezlere uyar", () => {
    expect(compileFormula("2+3*4").run(() => undefined)).toBe(14);
    expect(compileFormula("(2+3)*4").run(() => undefined)).toBe(20);
    expect(compileFormula("-(1+2)").run(() => undefined)).toBe(-3);
  });

  it("virgullu ondalik sayilari destekler", () => {
    expect(compileFormula("1,5+2,5").run(() => undefined)).toBe(4);
  });

  it("[REF] referanslarini getter uzerinden cozer", () => {
    const f = compileFormula("[A]+[B]");
    expect(f.refs).toEqual(["A", "B"]);
    expect(f.run((ref) => ({ A: 10, B: 20 }[ref]))).toBe(30);
  });

  it("referans eksikse (undefined) sonuc undefined olur", () => {
    const f = compileFormula("[A]+[B]");
    expect(f.run((ref) => (ref === "A" ? 10 : undefined))).toBeUndefined();
  });

  it("sifira bolme undefined doner (hata firlatmaz)", () => {
    const f = compileFormula("[A]/[B]");
    expect(f.run((ref) => ({ A: 10, B: 0 }[ref]))).toBeUndefined();
  });

  it("karmasik ifadeyi dogru hesaplar: ([BUDGET]-[ACTUAL])/[BUDGET]*100", () => {
    const f = compileFormula("([BUDGET]-[ACTUAL])/[BUDGET]*100");
    const get = (ref: string) => ({ BUDGET: 200, ACTUAL: 150 }[ref]);
    expect(f.run(get)).toBeCloseTo(25);
  });

  it("kapanmayan kose parantez hata firlatir", () => {
    expect(() => compileFormula("[A+1")).toThrow();
  });

  it("kapanmayan normal parantez hata firlatir", () => {
    expect(() => compileFormula("(1+2")).toThrow();
  });

  it("gecersiz karakter hata firlatir", () => {
    expect(() => compileFormula("1+@")).toThrow();
  });

  it("eksik formul (bos ya da operatorle biten) hata firlatir", () => {
    expect(() => compileFormula("1+")).toThrow();
  });

  it("formul sonunda fazlalik varsa hata firlatir", () => {
    expect(() => compileFormula("1 1")).toThrow();
  });
});
