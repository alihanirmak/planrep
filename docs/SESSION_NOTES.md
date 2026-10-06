# Oturum İlerleme Notları (yaşayan dosya — her oturumda güncellenir)

> Amaç: "kalınan yer" her zaman burada net olsun. Yeni bir oturuma başlarken önce bu dosyayı oku.

## 2026-06-10 — Faz 1 (Sprint 1.1+1.2) ve Faz 2 / Sprint 2.1 TAMAMLANDI

### Faz 1 (önceki kayıt, değişmedi)
Sprint 1.1 (`ec421f3`): lint borcu, cascade cleanup, SQL IN chunking, N+1 fix, Docker, DB yedekleme.
Sprint 1.2 (`bfb05ed`): Postgres değerlendirmesi, bulk upsert, pivot/query üst sınırı, Vitest (47 test).

### Faz 2 / Sprint 2.1 — bu oturumda tamamlandı: Workflow & Senaryo Yönetimi

**Veri modeli:**
- `workflow_items` tablosu: `scope_filters` (JSON `Record<dimCode,string[]>` — browser/scenarios
  sayfalarındaki filtre nesnesiyle aynı şekil), `status` zinciri
  `draft→submitted→in_review→approved→locked`, `rejected` her aşamadan dönüş,
  admin `reopen` ile `locked→draft`. `owner_id`/`approver_id`, zaman damgaları.
- `workflow_history`: append-only geçiş günlüğü (from/to status, user, comment).
- `src/lib/workflow.ts`: durum makinesi (`TRANSITION_RULES` + `canTransition`
  saf fonksiyon — rol/sahiplik/yorum-zorunluluğu kontrolü, hem API route'ta
  hem testte kullanılabilir), `applyTransition` (DB yazar + history ekler),
  CRUD fonksiyonları.

**Veri kilidi (en kritik kısım):** `locked` durumundaki bir workflow'un
`scope_filters`'ı, gerçek fact yazma/silme işlemlerini **gerçekten** engelliyor:
- `findBlockingLock(modelId, dims, coordsByDimCode)` — tek bir fact satırının
  koordinatının herhangi bir kilitli kapsama girip girmediğini `withDescendants`
  ile hiyerarşi-farkında kontrol eder (kısıtlanmayan boyutlar wildcard sayılır).
- `findBlockingLockForFilters(modelId, dims, filters)` — toplu silme gibi
  filtre-tabanlı işlemler için **kesişim** kontrolü (konservatif: kesişim varsa
  tüm işlem reddedilir).
- `upsertFacts` (`lib/facts-write.ts`) artık her satır için `findBlockingLock`
  kontrolü yapıyor, bulursa `WorkflowLockError` fırlatıyor (hiçbir şey
  yazılmadan, DB transaction'ı başlamadan önce). `/api/upload`,
  `/api/integrations/import`, `/api/scenario/copy` bunu yakalayıp `423 Locked`
  dönüyor (upload kaydını `status='failed'` yapıyor). `/api/facts` DELETE
  `findBlockingLockForFilters` ile ayrıca korunuyor.
- **Gerçek `next dev` sunucusuna karşı tam akış manuel API testiyle doğrulandı:**
  workflow oluştur → submit → review → approve → lock → kilitli kapsama
  scenario-copy denemesi **423 ile reddedildi**, kilit dışına yapılan aynı
  işlem **200 ile başarılı** oldu. (Script çalıştırıldı, silindi — kalıcı
  dosya eklenmedi.)

**Senaryo kopyalama/karşılaştırma:** `/api/scenario/copy` bir VERSION üyesinin
(örn. BUDGET) verisini başka bir üyeye (örn. FORECAST) kopyalar; sonuç normal
bir `uploads` kaydı olduğundan **mevcut** `/api/uploads/[id]/revert` ile geri
alınabilir (yeni bir revert mekanizması yazmaya gerek kalmadı). Karşılaştırma
ekranı (`/scenarios`) için de yeni backend gerekmedi — VERSION zaten sıradan
bir boyut olduğundan mevcut `/api/query` (`colDim=VERSION`) birebir
kullanıldı; sadece fark/fark% kolonları client-side eklendi.

**UI:** `/workflow` (liste + oluşturma, model+kapsam seçimi için mevcut
`MemberPicker` yeniden kullanıldı), `/workflow/[id]` (detay, durum rozetleri,
yorum + aksiyon butonları, geçmiş zaman çizelgesi), `/scenarios` (model + satır
boyutu + kaynak/hedef versiyon seçimi, karşılaştırma tablosu, kopyala butonu).
Nav (`Sidebar.tsx`) ve `i18n.ts`'e ilgili anahtarlar eklendi.

**Testler:** `workflow.test.ts` (12 test: durum makinesi, yetki, tam döngü +
history, kilit eşleştirme — tek koordinat ve filtre-kesişim). `facts-write.test.ts`'e
2 kilit senaryosu eklendi. **Toplam 61 test, hepsi geçiyor.**

**Doğrulama (tamamı yeşil):** `npm run lint` → 0 error, `tsc --noEmit` → temiz,
`npm test` → 61/61, `next build` → başarılı, gerçek sunucuya karşı manuel smoke
test → beklenen 200/201/423 sonuçları alındı.

**Bilinen sınırlama (gelecek oturum için not):** `revertUpload` kilit
kontrolünden geçmiyor — bir upload'ı geri almak, o veriyi sonradan kilitleyen
bir workflow'u göz ardı edebilir. Kapsam dışı bırakıldı (nadir edge-case),
ROADMAP.md'ye not düşüldü.

**Commit/push:** Bu sprint sonunda da commit + push yapılacak.

## Sıradaki adım

- **Faz 2 / Sprint 2.2** — Audit, formül motoru & iş kuralları: cell-level
  audit trail görünümü + rollback, formül motoruna `IF`/`SUMIF`/zaman-ofseti,
  iş kuralı (business rule) motoru.
