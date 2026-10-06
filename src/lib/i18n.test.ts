import { describe, it, expect } from "vitest";
import { getT, formatT, intlLocale } from "./i18n";

describe("getT", () => {
  it("tr locale icin tr sozlugunden deger doner", () => {
    const t = getT("tr");
    expect(t("common.save")).toBe("Kaydet");
  });

  it("en locale icin en sozlugunden deger doner", () => {
    const t = getT("en");
    expect(t("common.save")).toBe("Save");
  });

  it("gecersiz/eksik locale varsayilan olarak tr'ye doner", () => {
    const t = getT("fr");
    expect(t("common.save")).toBe("Kaydet");
  });
});

describe("formatT", () => {
  it("tek bir placeholder'i degistirir", () => {
    expect(formatT("Üst sınır: {max} hücre", { max: 20000 })).toBe("Üst sınır: 20000 hücre");
  });

  it("birden fazla placeholder'i degistirir", () => {
    expect(formatT("{count} / {max}", { count: 5, max: 10 })).toBe("5 / 10");
  });

  it("eslesmeyen placeholder'i oldugu gibi birakir", () => {
    expect(formatT("{unknown} ve {max}", { max: 1 })).toBe("{unknown} ve 1");
  });

  it("placeholder yoksa metni degistirmeden doner", () => {
    expect(formatT("sabit metin", {})).toBe("sabit metin");
  });
});

describe("intlLocale", () => {
  it("tr -> tr-TR", () => {
    expect(intlLocale("tr")).toBe("tr-TR");
  });

  it("en -> en-US", () => {
    expect(intlLocale("en")).toBe("en-US");
  });
});
