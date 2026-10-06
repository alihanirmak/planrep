import { describe, it, expect } from "vitest";
import { computeVirtualRange } from "./virtualize";

describe("computeVirtualRange", () => {
  it("totalCount 0 icin tum degerler sifir doner", () => {
    expect(computeVirtualRange({ totalCount: 0, rowHeight: 32, viewportHeight: 400, scrollTop: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });

  it("rowHeight 0 veya negatifse (henuz olculmemis) tum degerler sifir doner", () => {
    expect(computeVirtualRange({ totalCount: 1000, rowHeight: 0, viewportHeight: 400, scrollTop: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });

  it("viewportHeight 0 ise (henuz olculmemis) tum satirlari gorunur kabul eder", () => {
    const range = computeVirtualRange({ totalCount: 50, rowHeight: 32, viewportHeight: 0, scrollTop: 0 });
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(50);
    expect(range.topSpacerHeight).toBe(0);
    expect(range.bottomSpacerHeight).toBe(0);
  });

  it("scrollTop 0'da en basta, overscan kadar ekstra ust satir OLMADAN baslar (0'in altina inemez)", () => {
    const range = computeVirtualRange({
      totalCount: 1000,
      rowHeight: 32,
      viewportHeight: 320, // 10 satir gorunur
      scrollTop: 0,
      overscan: 5,
    });
    expect(range.startIndex).toBe(0);
    expect(range.topSpacerHeight).toBe(0);
    // 10 gorunur + 2*5 overscan = 20
    expect(range.endIndex).toBe(20);
  });

  it("orta bir noktaya kaydirildiginda startIndex/topSpacer dogru hesaplanir", () => {
    const range = computeVirtualRange({
      totalCount: 1000,
      rowHeight: 32,
      viewportHeight: 320,
      scrollTop: 3200, // tam 100. satirin basi
      overscan: 5,
    });
    // raw start = 100 - 5 = 95
    expect(range.startIndex).toBe(95);
    expect(range.topSpacerHeight).toBe(95 * 32);
  });

  it("listenin sonuna yakin kaydirildiginda endIndex totalCount'u asmaz, bottomSpacer sifira yaklasir", () => {
    const range = computeVirtualRange({
      totalCount: 100,
      rowHeight: 32,
      viewportHeight: 320,
      scrollTop: 100 * 32 - 320, // en sona kaydirilmis
      overscan: 5,
    });
    expect(range.endIndex).toBe(100);
    expect(range.bottomSpacerHeight).toBe(0);
  });

  it("viewport tum icerikten buyukse (az satir var) tum satirlar gorunur, spacer'lar sifir", () => {
    const range = computeVirtualRange({
      totalCount: 10,
      rowHeight: 32,
      viewportHeight: 2000,
      scrollTop: 0,
      overscan: 8,
    });
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(10);
    expect(range.topSpacerHeight).toBe(0);
    expect(range.bottomSpacerHeight).toBe(0);
  });

  it("ozel overscan parametresi dogru uygulanir", () => {
    const base = { totalCount: 1000, rowHeight: 32, viewportHeight: 320, scrollTop: 3200 };
    const small = computeVirtualRange({ ...base, overscan: 1 });
    const large = computeVirtualRange({ ...base, overscan: 20 });
    expect(small.startIndex).toBe(99); // 100 - 1
    expect(large.startIndex).toBe(80); // 100 - 20
    expect(large.endIndex - large.startIndex).toBeGreaterThan(small.endIndex - small.startIndex);
  });

  it("overscan verilmezse varsayilan (8) kullanilir", () => {
    const range = computeVirtualRange({ totalCount: 1000, rowHeight: 32, viewportHeight: 320, scrollTop: 3200 });
    expect(range.startIndex).toBe(92); // 100 - 8
  });
});
