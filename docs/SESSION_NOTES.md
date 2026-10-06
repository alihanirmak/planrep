# Oturum İlerleme Notları (yaşayan dosya — her oturumda güncellenir)

> Amaç: "kalınan yer" her zaman burada net olsun. Yeni bir oturuma başlarken önce bu dosyayı oku.

## 2026-06-10 — Sprint 1.1 TAMAMLANDI (lint borcu + 5 madde)

**Lint borcu (önceki oturumdan devam):** `DashboardWidget.tsx`/`ReportView.tsx`'teki
reset+fetch zincirleri `Promise.resolve().then()` pattern'ine, `Sidebar.tsx`'teki
cookie yazımı component-dışı `setLocaleCookie()` fonksiyonuna taşındı;
`reports/page.tsx`'teki `DropZone` kullanımlarına eksik `dims`/`onMove` prop'ları
eklendi (bu da bir typecheck hatasını ortaya çıkardı, düzeltildi).

**Sprint 1.1 maddeleri:**
- **Cascade cleanup:** `reports`/`dashboards` DELETE route'ları artık kendi
  `comments` kayıtlarını siliyor; `models` DELETE artık cascade-silinen
  raporların yorumlarını siliyor ve o modele ait private dimension'ların
  `owner_model_id`'sini `NULL`'a çeviriyor (önceden dangling kalıyordu).
- **SQL IN(...) chunking:** Yeni `src/lib/fact-filters.ts` — `buildFactWhereVariants()`
  dims+filters+access'ten WHERE varyantları üretir, herhangi bir boyutun kod
  listesi 400'ü aşarsa kesişimsiz chunk'lara bölüp kartezyen varyantlar döner.
  `query.ts`, `pivot/route.ts`, `facts/route.ts` (buildWhere, POST, DELETE) bu
  helper'ı kullanacak şekilde refactor edildi; aggregate (SUM/GROUP BY) sonuçlar
  `sumGroupedRows()` ile anahtar bazlı yeniden toplanıyor, facts POST'ta >1
  varyant durumunda sayfalama JS tarafında yapılıyor (nadir edge-case).
  Not: better-sqlite3/SQLite şu an pratikte 32766 parametre limitine sahip
  (999 eski varsayım), ama roadmap maddesi yine de defensive olarak uygulandı.
- **N+1 optimizasyonu:** `lib/model.ts`'teki `getModelDims`/`getModels` ve
  `/api/dimensions` GET artık per-item döngüde ayrı sorgu yerine `IN (...)` ile
  toplu sorgu + JS'te gruplama kullanıyor.
- **Dockerfile + docker-compose.yml:** 3-stage Dockerfile (deps/builder/runner,
  `node:20-slim`, better-sqlite3 native derleme deps builder'da). `next.config.ts`'e
  `output: "standalone"` eklendi. `docker-compose.yml`'de `app` servisi
  (JWT_SECRET zorunlu env, named volume `/app/data`) ve `backup` servisi
  (`profiles: tools`, `docker compose run --rm backup`). Docker CLI bu ortamda
  yok, bu yüzden gerçek `docker build` çalıştırılamadı; onun yerine
  `next build` + `.next/standalone/server.js`'i manuel ayağa kaldırıp
  (`better-sqlite3` native modülün standalone tracing'e doğru dahil olduğu ve
  login sayfasının düzgün render edildiği) doğrulandı.
- **DB yedekleme scripti:** `scripts/backup-db.js` — `better-sqlite3`'ün
  `db.backup()` API'siyle WAL-güvenli tutarlı snapshot alır, `BACKUP_RETENTION`
  (varsayılan 14) kadarını saklayıp eskileri siler. `npm run db:backup` ile
  çalıştırılabilir. `.gitignore`'a `/data/backups/` eklendi.
  `eslint.config.mjs`'e `scripts/**` ignore eklendi (CJS `require()` kullanıyor,
  Next app kod tabanının lint kurallarına tabi değil).

**Doğrulama (tamamı yeşil):** `npm run lint` → 0 error (2 pre-existing warning),
`tsc --noEmit` → temiz, `next build` → başarılı.

**Commit/push:** Bu sprint sonunda kullanıcı talebiyle commit + push yapıldı
(bundan sonraki her sprint sonunda da aynı şekilde yapılacak).

## Sıradaki adım

- **Faz 1 / Sprint 1.2** — veri katmanı & test altyapısı: PostgreSQL geçiş
  değerlendirmesi, `upsertFacts` bulk upsert, `/api/pivot`+`/api/query` sayfalama/
  üst sınır, Vitest/Jest kurulumu + `lib/formula.ts`/`lib/pivot.ts`/`lib/access.ts`/
  `lib/facts-write.ts`/`lib/query.ts` birim testleri.
