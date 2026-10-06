# Oturum İlerleme Notları (yaşayan dosya — her oturumda güncellenir)

> Amaç: "kalınan yer" her zaman burada net olsun. Yeni bir oturuma başlarken önce bu dosyayı oku.

## 2026-06-10 — Faz 1 TAMAMLANDI (Sprint 1.1 + Sprint 1.2)

### Sprint 1.1 (önceki kayıt, değişmedi)
Lint borcu, cascade cleanup, SQL IN(...) chunking, N+1 optimizasyonu, Docker,
DB yedekleme scripti — commit `ec421f3`, push edildi.

### Sprint 1.2 — bu oturumda tamamlandı

- **PostgreSQL geçiş değerlendirmesi:** Kod yazmak yerine bir **karar dokümanı**
  gerekiyordu (roadmap maddesi "değerlendirme" diyor). `docs/ARCHITECTURE_AUDIT.md`
  §6'ya eklendi: karar = **şimdilik better-sqlite3'te kal**, Postgres'e geçiş
  Faz 2/3'e (gerçek çoklu-kullanıcı yüküne) bırakıldı; tetikleyici kriterler
  (eşzamanlı kullanıcı >50, facts tablosu onlarca milyon satır, ölçekleme
  ihtiyacı) ve geçiş yapılırsa izlenecek adımlar yazıldı.
- **`upsertFacts` bulk upsert:** `src/lib/facts-write.ts` tamamen yeniden
  yazıldı. Eski: N satır için 3N sorgu (SELECT+DELETE+INSERT döngüsü). Yeni:
  TEMP tabloya toplu coord yazımı → eski değerler TEK JOIN sorgusuyla okunup
  backup'lanıyor → eski satırlar TEK EXISTS-tabanlı DELETE ile siliniyor →
  yeni satırlar `ROWS_PER_INSERT=80`'lik çoklu-satır (multi-row VALUES)
  INSERT'lerle toplu ekleniyor. `revertUpload` da ayni toplu-insert helper'ını
  kullanıyor. better-sqlite3'ün `.run(...unknown[])` spread'inde TS2556 hatası
  için `runStmt()` (apply tabanlı) yardımcı fonksiyonu eklendi. Manuel ve
  sonra Vitest testleriyle (bkz. alt) doğrulandı: ilk upsert/ezme/revert/777
  satırlık chunk-sınırını-aşan toplu yazım — hepsi doğru.
- **`/api/pivot` + `/api/query` üst sınır:** Hiyerarşik rollup (`lib/pivot.ts`,
  `lib/query.ts`) **client-side kurulduğu** için klasik page/pageSize
  sayfalaması sonucu kırpmak YANLIŞ toplam üretir (parent rollup'ları için
  bazı leaf'ler eksik kalır). Bunun yerine `lib/fact-filters.ts`'e
  `MAX_AGGREGATE_RESULT_ROWS=20000` eklendi: SQL aggregate sonucu (satır×sütun
  hücre sayısı) bu sınırı aşarsa veri KIRPILMAZ, `result_too_large` hatası
  dönülür (kullanıcı filtre eklemeye yönlendirilir). `query.ts`/`pivot/route.ts`/
  `api/query/route.ts` buna göre güncellendi.
- **Vitest test altyapısı:** `vitest@^3` kuruldu (vitest@5, @types/node ^22+
  istediği için proje `@types/node@^20` ile uyumsuzdu — v3 seçildi).
  `vitest.config.ts` (`@/*` alias, node environment). 5 modül için 47 test:
  `formula.test.ts` (12, pure), `pivot.test.ts` (10, pure), `access.test.ts`
  (14), `facts-write.test.ts` (5), `query.test.ts` (6, 450 üyelik parent
  filtresiyle IN(...) chunking yolu da test ediliyor). **Önemli pattern:**
  `lib/model.ts`/`lib/access.ts`/`lib/query.ts`/`lib/facts-write.ts` import
  edildiklerinde transitively `lib/db/index.ts`'i tetikliyor (dosya oluşturma +
  DDL + demo seed yan etkisi) — bu yüzden her DB'ye dokunan test dosyası
  `beforeAll` içinde ÖNCE `process.env.DATABASE_PATH`'i benzersiz bir geçici
  dosyaya ayarlıyor, SONRA `await import(...)` ile modülü yüklüyor (statik
  import kullanılırsa env ayarından önce çalışır). `package.json`'a
  `test`/`test:watch` scriptleri eklendi.

**Doğrulama (tamamı yeşil):** `npm run lint` → 0 error (2 pre-existing
warning), `tsc --noEmit` → temiz, `npm test` (vitest run) → 47/47 geçti,
`next build` → başarılı.

**Commit/push:** Bu sprint sonunda da kullanıcı talebiyle commit + push
yapılacak (bir önceki committen sonraki tüm Sprint 1.2 değişiklikleri).

## Sıradaki adım

- **Faz 2 / Sprint 2.1** — Workflow & senaryo yönetimi: submit→review→approve→lock
  veri modeli + UI, VERSION dimension üzerine senaryo kopyalama/karşılaştırma
  ekranı. Bu, önceki sprintlerden daha büyük/yeni-özellik ağırlıklı bir sprint;
  önce veri modeli (yeni tablo(lar): workflow_state, approval_log vb.) tasarımı
  yapılmalı.
