import { describe, it, expect } from "vitest";
import { withTimeOffsets } from "./time-offset";

const data: Record<string, number> = {
  "2026-03": 120,
  "2025-03": 100,
  "2026-01": 10,
  "2026-02": 20,
  "2024-03": 80,
  "2026": 500,
  "2025": 400,
};
const base = (ref: string) => data[ref];

describe("withTimeOffsets", () => {
  it(".PY (onceki yil) ayni ay/donem icin dogru koda yonlendirir", () => {
    const get = withTimeOffsets(base);
    expect(get("2026-03.PY")).toBe(100);
  });

  it(".PY yil-only kodlarda da calisir", () => {
    const get = withTimeOffsets(base);
    expect(get("2026.PY")).toBe(400);
  });

  it(".PY hedef veri yoksa undefined doner", () => {
    const get = withTimeOffsets(base);
    expect(get("2030-01.PY")).toBeUndefined(); // 2029-01 veri setinde yok
  });

  it(".PY gecersiz kod formatinda undefined doner", () => {
    const get = withTimeOffsets(base);
    expect(get("CC100.PY")).toBeUndefined();
  });

  it(".MOVAVG(n) son n ayin ortalamasini hesaplar", () => {
    const get = withTimeOffsets(base);
    expect(get("2026-02.MOVAVG(2)")).toBe((20 + 10) / 2);
  });

  it(".MOVAVG eksik donemleri atlar (var olanlarin ortalamasi)", () => {
    const get = withTimeOffsets(base);
    // 2026-01'den geriye 3 donem: 2026-01, 2025-12, 2025-11 -> sadece 2026-01 var
    expect(get("2026-01.MOVAVG(3)")).toBe(10);
  });

  it(".MOVAVG tum donemler eksikse undefined doner", () => {
    const get = withTimeOffsets(base);
    expect(get("2099-01.MOVAVG(3)")).toBeUndefined();
  });

  it("sonek olmayan normal referanslari degistirmeden alt getter'a iletir", () => {
    const get = withTimeOffsets(base);
    expect(get("2026-03")).toBe(120);
    expect(get("UNKNOWN")).toBeUndefined();
  });
});
