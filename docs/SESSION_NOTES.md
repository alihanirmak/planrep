# Oturum İlerleme Notları (yaşayan dosya — her oturumda güncellenir)

> Amaç: "kalınan yer" her zaman burada net olsun. Yeni bir oturuma başlarken önce bu dosyayı oku.

## 2026-06-10 — Faz 2 / Sprint 2.2 TAMAMLANDI (Audit, formül motoru, iş kuralları)

### Önceki kayıtlar (değişmedi)
- Faz 1 (Sprint 1.1 `ec421f3` + Sprint 1.2 `bfb05ed`)
- Faz 2 / Sprint 2.1 (Workflow + senaryo, `3a6e4f2`)

### Sprint 2.2 — bu oturumda tamamlandı

**1. Hücre bazlı audit trail + rollback:**
- Yeni `fact_audit` tablosu: her upsert/revert/rollback için bir satır (model_id,
  upload_id, d1..d8 koordinat, old_value, new_value, source, user_id, created_at).
- `lib/facts-write.ts`: `upsertFacts` artık eski değerleri okurken aynı anda
  `fact_audit`'e toplu yazıyor (`logFactAuditBulk`, chunk'lı multi-row INSERT).
  `revertUpload` da hem "ezilen eski değer geri geldi" hem "yeni eklenmiş satır
  silindi" durumlarını `source='revert'` ile kaydediyor.
- `lib/fact-audit.ts`: `listFactAudit` (model/koordinat/upload filtresi),
  `rollbackFactAudit` — eski değer varsa yeni bir `uploads` kaydı açıp
  `upsertFacts` ile geri yazıyor (yani lock/business-rule kontrolünden geçiyor,
  kilitli bir hücreyi "geri alma" yoluyla bypass etmek mümkün değil), eski
  değer yoksa (satır o değişiklikten önce yoktu) satırı silip `source='rollback'`
  audit kaydı açıyor.
- `/api/fact-audit` (liste), `/api/fact-audit/[id]/rollback` (geri alma),
  `/admin/audit/cells` sayfası (model+boyut filtresi, tablo, geri al butonu).
  `/admin/audit` ana sayfasına link eklendi.

**2. Formül motoru genişletildi (`lib/formula.ts`):**
- `IF(kosul;evet;hayır)` + karşılaştırma operatörleri (`> < >= <= = <>`), iç içe
  IF, `SUM/AVG/MIN/MAX(...)` fonksiyonları (eksik/undefined argümanlar atlanır).
- **Kritik tasarım kararı:** fonksiyon argüman ayracı virgül DEĞİL, noktalı
  virgül (`;`) — çünkü tr-TR ondalık ayracı da virgül (`1,5`) ve ikisi
  `IF(a,b,c)` içinde çakışıyordu. Tokenizer artık virgülü sadece hemen
  ardından rakam geliyorsa ondalık parçası sayıyor. Bu, Excel'in tr-TR
  `EĞER(a;b;c)` konvansiyonuyla da örtüşüyor.
- Zaman-serisi ofseti (`.PY`, `.MOVAVG(n)`) **ayrı bir modülde** (`lib/time-offset.ts`)
  — formül motorunun kendisine hiç dokunulmadı, `withTimeOffsets(baseGetter)`
  bir `Getter` sarmalayıcısı. `report-types.ts` (`computeCalcCells`) ve
  `ReportView.tsx` (`calcRowsComputed`) bunu kullanacak şekilde güncellendi.
  Reports sayfasındaki hesaplanan kolon/satır bölümlerine güncel sözdizimi
  ipucu eklendi.

**3. İş kuralı (business rule) motoru:**
- Yeni `business_rules` tablosu (model_id, scope_filters JSON, op, value,
  severity: block/warn, message, active).
- `lib/business-rules.ts`: CRUD + `evaluateBusinessRules`. Kapsam eşleşmesi
  için workflow kilidiyle AYNI mantık gerekiyordu — bu yüzden `scopeMatchesCoord`/
  `scopesOverlap` `lib/fact-filters.ts`'e ortak yardımcı olarak taşındı,
  `workflow.ts` da buna refactor edildi (kod tekrarı önlendi).
- `upsertFacts` her satır için önce lock, sonra business-rule kontrolü yapıyor:
  `block` → `BusinessRuleError` (hiçbir şey yazılmaz, transaction başlamadan
  önce), `warn` → `UpsertFactsResult.warnings` içinde döner, yazmayı durdurmaz.
  `/api/upload`, `/api/integrations/import`, `/api/scenario/copy` → `BusinessRuleError`'ı
  `400 business_rule_violated` yapıyor, `warnings`'i response'a ekliyor.
- Kural yönetim UI'ı ayrı sayfa değil — `modeling/models/[id]/page.tsx` model
  detay sayfasına gömülü (CRUD + aktif/pasif toggle, mevcut `MemberPicker`
  kapsamseçimi için yeniden kullanıldı).

**Testler:** 24 yeni test eklendi → **toplam 100 test** (`business-rules.test.ts`
10, `time-offset.test.ts` 8, `formula.test.ts`'e +15, `facts-write.test.ts`'e +6).
Gerçek `next dev` sunucusuna karşı manuel smoke test: business-rule CRUD,
scenario-copy→fact_audit→rollback tam döngüsü, block kuralının scenario-copy'yi
400 ile reddetmesi (ilk denemede hata mesajı aynı kural için N kez tekrarlıyordu
— `BusinessRuleError` kural-id'ye göre dedupe edilerek düzeltildi) doğrulandı;
`/workflow`, `/scenarios`, `/admin/audit/cells`, `/modeling/models/[id]`,
`/reports` sayfalarının hepsi 200 döndü.

**Doğrulama (tamamı yeşil):** `npm run lint` → 0 error, `tsc --noEmit` → temiz,
`npm test` → 100/100, `next build` → başarılı.

**Not — oturum sürekliliği:** Bu sprintin bir kısmı (API route'ları:
`/api/business-rules`, `/api/fact-audit`, UI: `/admin/audit/cells`,
`modeling/models/[id]/page.tsx` güncellemesi) daha önceki bir ara adımda
yazılmış halde bulundu (muhtemelen context sınırı nedeniyle bu dosyaya not
düşmeden ilerlenmişti); bu oturumda önce bu dosyaların içeriği okunup
doğrulandı, sonra kalan iş (dedupe fix, testler, smoke test, dokümantasyon)
tamamlandı. Gelecekte benzer bir kesinti olursa: `git status` ile
untracked/modified dosyalara bakmak, kalan işin nereden devam edeceğini
anlamak için en güvenilir yöntem.

**Commit/push:** Bu sprint sonunda da commit + push yapılacak.

## Sıradaki adım

- **Faz 2 / Sprint 2.3** — Entegrasyon, erişilebilirlik & bildirimler:
  connector plugin mimarisi (statik dizi → DB'de dinamik kayıt), a11y
  iyileştirmeleri (MemberPicker/DrillModal focus-trap/ESC/ARIA), i18n'i export
  dosyalarına (PPTX/Excel) ve kalan hata mesajlarına tam yayma, bildirim
  sistemi (yorum/mention, in-app), zamanlanmış SAP senkronizasyonu (cron/webhook).
