import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const manifestPath = path.resolve(__dirname, "../../public/manifest.json");
const swPath = path.resolve(__dirname, "../../public/sw.js");
const iconPath = path.resolve(__dirname, "../../public/icons/icon.svg");

describe("public/manifest.json — PWA manifest gecerliligi", () => {
  it("gecerli bir JSON dosyasidir", () => {
    const raw = fs.readFileSync(manifestPath, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("PWA kurulumu icin zorunlu alanlari icerir", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(typeof manifest.background_color).toBe("string");
    expect(typeof manifest.theme_color).toBe("string");
  });

  it("en az bir 'any' ve bir 'maskable' purpose icon tanimlar", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  it("tanimlanan her icon dosyasi public/ altinda fiilen var olmali", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const publicDir = path.resolve(__dirname, "../../public");
    for (const icon of manifest.icons) {
      const iconFile = path.join(publicDir, icon.src.replace(/^\//, ""));
      expect(fs.existsSync(iconFile)).toBe(true);
    }
  });
});

describe("public/icons/icon.svg", () => {
  it("gecerli bir SVG dosyasidir (kok eleman <svg>)", () => {
    const raw = fs.readFileSync(iconPath, "utf8").trim();
    expect(raw.startsWith("<svg")).toBe(true);
    expect(raw).toContain("</svg>");
  });
});

describe("public/sw.js — service worker", () => {
  it("gecerli JavaScript sozdizimine sahiptir (parse edilebilir)", () => {
    const raw = fs.readFileSync(swPath, "utf8");
    // new Function ile parse-only kontrol — service worker global'leri
    // (self, caches) burada tanimli degil ama sozdizimi gecerliligi icin
    // calistirmaya gerek yok, sadece parse edilebilmesi yeterli.
    expect(() => new Function(raw)).not.toThrow();
  });

  it("sadece statik app-shell varliklarini (GET + ayni origin) hedefler, API/HTML'i KAPSAMAZ", () => {
    const raw = fs.readFileSync(swPath, "utf8");
    expect(raw).toContain('req.method !== "GET"');
    expect(raw).toContain("SHELL_PATTERNS");
    expect(raw).toContain("_next");
    expect(raw).toContain("static");
    // /api/ veya genel HTML sayfalarini cache'leyen bir desen OLMAMALI —
    // bu kasitli tasarim kararinin (bkz. dosya basindaki yorum) kod
    // tarafinda da dogrulanmasi icin.
    expect(raw).not.toMatch(/\/api\//);
  });

  it("install asamasinda skipWaiting cagirir (yeni surumun hemen devreye girmesi icin)", () => {
    const raw = fs.readFileSync(swPath, "utf8");
    expect(raw).toContain("skipWaiting");
  });

  it("activate asamasinda eski cache surumlerini temizler", () => {
    const raw = fs.readFileSync(swPath, "utf8");
    expect(raw).toContain("caches.delete");
  });
});
