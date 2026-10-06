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

describe("compileFormula — IF ve karsilastirma operatorleri", () => {
  it("IF(cond; then; else) temel kullanim", () => {
    expect(compileFormula("IF(1>0; 10; 20)").run(() => undefined)).toBe(10);
    expect(compileFormula("IF(1<0; 10; 20)").run(() => undefined)).toBe(20);
  });

  it("tum karsilastirma operatorlerini destekler: > < >= <= = <>", () => {
    const get = () => undefined;
    expect(compileFormula("IF(2>1;1;0)").run(get)).toBe(1);
    expect(compileFormula("IF(1<2;1;0)").run(get)).toBe(1);
    expect(compileFormula("IF(2>=2;1;0)").run(get)).toBe(1);
    expect(compileFormula("IF(2<=2;1;0)").run(get)).toBe(1);
    expect(compileFormula("IF(2=2;1;0)").run(get)).toBe(1);
    expect(compileFormula("IF(2<>3;1;0)").run(get)).toBe(1);
  });

  it("ic ice IF destekler", () => {
    const f = compileFormula("IF([A]>100; 1; IF([A]>50; 2; 3))");
    expect(f.run((ref) => ({ A: 150 }[ref]))).toBe(1);
    expect(f.run((ref) => ({ A: 75 }[ref]))).toBe(2);
    expect(f.run((ref) => ({ A: 10 }[ref]))).toBe(3);
  });

  it("kosul icindeki referans eksikse (undefined) IF sonucu undefined olur", () => {
    const f = compileFormula("IF([A]>0; 1; 2)");
    expect(f.run(() => undefined)).toBeUndefined();
  });

  it("gercek senaryo: bütçe asimi yuzdesi", () => {
    const f = compileFormula("IF([BUDGET]=0; 0; ([ACTUAL]-[BUDGET])/[BUDGET]*100)");
    expect(f.run((ref) => ({ BUDGET: 200, ACTUAL: 250 }[ref]))).toBeCloseTo(25);
    expect(f.run((ref) => ({ BUDGET: 0, ACTUAL: 100 }[ref]))).toBe(0);
  });

  it("IF icindeki referanslar refs listesine dahil olur", () => {
    const f = compileFormula("IF([A]>[B]; [A]; [B])");
    expect(f.refs.sort()).toEqual(["A", "A", "B", "B"].sort());
  });
});

describe("compileFormula — SUM/AVG/MIN/MAX fonksiyonlari", () => {
  it("SUM birden fazla argumani toplar", () => {
    const f = compileFormula("SUM([A];[B];[C])");
    expect(f.run((ref) => ({ A: 10, B: 20, C: 30 }[ref]))).toBe(60);
  });

  it("SUM/AVG eksik (undefined) argumanlari atlar", () => {
    const sum = compileFormula("SUM([A];[B];[C])");
    expect(sum.run((ref) => ({ A: 10, C: 30 }[ref]))).toBe(40);
    const avg = compileFormula("AVG([A];[B];[C])");
    expect(avg.run((ref) => ({ A: 10, C: 30 }[ref]))).toBe(20);
  });

  it("tum argumanlar eksikse sonuc undefined olur", () => {
    expect(compileFormula("SUM([A];[B])").run(() => undefined)).toBeUndefined();
  });

  it("MIN ve MAX dogru calisir", () => {
    const get = (ref: string) => ({ A: 5, B: 20, C: -3 }[ref]);
    expect(compileFormula("MIN([A];[B];[C])").run(get)).toBe(-3);
    expect(compileFormula("MAX([A];[B];[C])").run(get)).toBe(20);
  });

  it("fonksiyonlar baska ifadelerle birlesebilir: SUM([A];[B])*2", () => {
    expect(compileFormula("SUM([A];[B])*2").run((ref) => ({ A: 5, B: 5 }[ref]))).toBe(20);
  });

  it("tek argumanli SUM/AVG/MIN/MAX gecerlidir", () => {
    expect(compileFormula("SUM([A])").run((ref) => ({ A: 7 }[ref]))).toBe(7);
  });

  it("bos argumanli fonksiyon (SUM()) hata firlatir", () => {
    expect(() => compileFormula("SUM()")).toThrow();
  });

  it("bilinmeyen fonksiyon adi hata firlatir", () => {
    expect(() => compileFormula("FOO([A])")).toThrow();
  });

  it("IF icinde SUM kullanilabilir", () => {
    const f = compileFormula("IF(SUM([A];[B])>10; 1; 0)");
    expect(f.run((ref) => ({ A: 6, B: 6 }[ref]))).toBe(1);
    expect(f.run((ref) => ({ A: 1, B: 1 }[ref]))).toBe(0);
  });
});

describe("compileFormula — SUMIF fonksiyonu", () => {
  it("tek kosul-deger ikilisinde kosul dogruysa degeri doner", () => {
    const f = compileFormula("SUMIF([ACTUAL]>[BUDGET]; [ACTUAL])");
    expect(f.run((ref) => ({ ACTUAL: 150, BUDGET: 100 }[ref]))).toBe(150);
  });

  it("kosul yanlissa o ikili toplama dahil olmaz", () => {
    const f = compileFormula("SUMIF([ACTUAL]>[BUDGET]; [ACTUAL])");
    expect(f.run((ref) => ({ ACTUAL: 50, BUDGET: 100 }[ref]))).toBeUndefined();
  });

  it("birden fazla kosul-deger ikilisini destekler, eslesenleri toplar", () => {
    const f = compileFormula("SUMIF([A1]>[B1]; [A1]; [A2]>[B2]; [A2]; [A3]>[B3]; [A3])");
    const get = (ref: string) =>
      ({ A1: 150, B1: 100, A2: 50, B2: 100, A3: 200, B3: 100 } as Record<string, number>)[ref];
    // A1>B1 (150>100) dogru -> 150; A2>B2 (50>100) yanlis -> atlanir; A3>B3 (200>100) dogru -> 200
    expect(f.run(get)).toBe(350);
  });

  it("tum kosullar yanlissa veya eksikse sonuc undefined olur", () => {
    const f = compileFormula("SUMIF([A]>[B]; [A]; [C]>[D]; [C])");
    expect(f.run((ref) => ({ A: 1, B: 10, C: 1, D: 10 }[ref]))).toBeUndefined();
  });

  it("kosuldaki referans eksikse (undefined) o ikili atlanir", () => {
    const f = compileFormula("SUMIF([A]>[B]; [A]; [C]>[D]; [C])");
    // A/B eksik -> ilk kosul hesaplanamaz (atlanir); C>D (20>10) dogru -> 20
    expect(f.run((ref) => ({ C: 20, D: 10 }[ref]))).toBe(20);
  });

  it("tum karsilastirma operatorlerini destekler", () => {
    const get = () => undefined;
    expect(compileFormula("SUMIF(1>0; 5)").run(get)).toBe(5);
    expect(compileFormula("SUMIF(1<2; 5)").run(get)).toBe(5);
    expect(compileFormula("SUMIF(2>=2; 5)").run(get)).toBe(5);
    expect(compileFormula("SUMIF(2<=2; 5)").run(get)).toBe(5);
    expect(compileFormula("SUMIF(2=2; 5)").run(get)).toBe(5);
    expect(compileFormula("SUMIF(2<>3; 5)").run(get)).toBe(5);
  });

  it("gercek senaryo: butceyi asan hesaplarin toplami", () => {
    const f = compileFormula("SUMIF([ACTUAL1]>[BUDGET1]; [ACTUAL1]; [ACTUAL2]>[BUDGET2]; [ACTUAL2])");
    const get = (ref: string) =>
      ({ ACTUAL1: 120, BUDGET1: 100, ACTUAL2: 80, BUDGET2: 100 } as Record<string, number>)[ref];
    expect(f.run(get)).toBe(120);
  });

  it("baska ifadelerle birlesebilir: SUMIF(...)*2", () => {
    const f = compileFormula("SUMIF([A]>0; [A])*2");
    expect(f.run((ref) => ({ A: 10 }[ref]))).toBe(20);
  });

  it("ikililerdeki tum referanslar refs listesine dahil olur", () => {
    const f = compileFormula("SUMIF([A]>[B]; [C])");
    expect(f.refs.sort()).toEqual(["A", "B", "C"].sort());
  });

  it("eksik ikili (SUMIF(cond)) hata firlatir", () => {
    expect(() => compileFormula("SUMIF([A]>0)")).toThrow();
  });

  it("bos SUMIF() hata firlatir", () => {
    expect(() => compileFormula("SUMIF()")).toThrow();
  });
});
