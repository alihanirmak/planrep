# PlanRep — Geliştirme Yol Haritası & Takip Listesi

> **Nasıl kullanılır:** Bu dosya yaşayan bir takip listesidir. Bir madde üzerinde çalışmaya başlarken `[ ]` → işe başlandığında yorum/PR linki ekleyin, tamamlandığında `[x]` yapın. Detaylı mimari gerekçeler için `ARCHITECTURE_AUDIT.md`'ye bakın.
>
> **ÇALIŞMA KURALI (2026-06-10'dan itibaren geçerli, bağlayıcı):** Her sprint, içindeki maddeler **tek tek** işlenecek şekilde tasarlanmıştır. Bir sprinte başlandığında:
> 1. Sprint içindeki **ilk işaretsiz (`[ ]`) madde** seçilir ve yalnızca o madde geliştirilir.
> 2. Madde tamamlanıp doğrulandığında (ilgili lint/typecheck/test/build çalıştırılır) `[x]` yapılır, kısa bir tamamlama notu eklenir ve **orada durulur**.
> 3. Aynı sprintin veya fazın diğer maddelerine, kullanıcıdan yeni bir talimat/onay gelmeden **otomatik geçilmez**. Bir sprintin veya fazın tamamı tek seferde/tek oturumda bitirilmeye çalışılmaz.
> 4. Bu kural hâlihazırda tamamlanmış (Faz 0, Sprint 1.1, Sprint 1.2, Sprint 2.1, Sprint 2.2, Sprint 2.3 madde 1) işler için geriye dönük değildir — sadece bundan sonraki geliştirmeler için geçerlidir.
>
> **Son güncelleme:** 2026-06-10 — Faz 1 (Sprint 1.1 + Sprint 1.2) tamamlandı: lint borcu, cascade cleanup, IN(...) chunking, N+1 optimizasyonu, Docker, DB yedekleme, Postgres geçiş değerlendirmesi, bulk upsert, pivot/query üst sınırı, Vitest test altyapısı. Faz 2 / Sprint 2.1 + Sprint 2.2 tamamlandı: workflow onay akışı (data lock dahil), senaryo kopyalama/karşılaştırma, hücre bazlı audit trail + rollback, formül motoru (IF/SUM/AVG/MIN/MAX + zaman ofseti), iş kuralı (business rule) motoru. Sprint 2.3 kısmen tamamlandı: connector plugin mimarisi (dinamik DB-tabanlı bağlantı yönetimi).
> **Doğrulama turu (2026-06-10, kod değiştirilmedi):** Faz 0, Sprint 1.1, Sprint 2.1 ve Sprint 2.3 madde 1'deki tüm `[x]` işaretli maddeler kaynak kodda tek tek doğrulandı — hepsi gerçekten tam uygulanmış. İki maddede kısmi eksik bulundu: Sprint 1.2 "pivot/query üst sınır+sayfalama" (sayfalama yok, sadece sert limit) ve Sprint 2.2 "formül motoru" (SUMIF yok, sadece SUM var) — bu eksikler aşağıda **Sprint 2.3 (devam)**'a ayrı madde olarak taşındı (artık ilgili eski maddelerin notunda gömülü değil). Ayrıca a11y maddesi için commit edilmemiş kısmi bir çalışma bulundu (`src/lib/a11y.ts` + `MemberPicker`/`DrillModal` entegrasyonu) — bu da aşağıdaki sprintte ayrı bir madde.
> **Sprint yeniden düzenleme (bu oturum):** Sprint 2.3'ün kalan maddeleri + yukarıdaki iki yarım-kalan teknik borç, tek bir "Sprint 2.3 (devam)" içinde önceliklendirildi (basitten karmaşığa, bağımlılık sırasına göre). Faz 3'ün üç sprinti de kendi içinde basitten karmaşığa / düşük riskliden yüksek riskliye yeniden sıralandı (orijinal sıra mimari bağımlılık/karmaşıklık gözetmiyordu).

---

## Faz 0 — Acil (1-2 hafta, production-blocker borçlar)

- [x] Proje klasörünü git repo'ya alma (`git init`), `.gitignore` kontrolü
- [x] CI pipeline kurulumu (lint + typecheck + build, minimal)
- [x] `JWT_SECRET` zorunlu env yap, hardcoded fallback'i kaldır (`lib/session.ts:5-7`)
- [x] Session cookie'ye `secure: true` flag ekle (prod'da)
- [x] `api/export/excel`, `api/export/pptx` route'larına Zod şema doğrulama + try/catch ekle
- [x] `api/comments/route.ts` GET/POST'a entity-level yetkilendirme (rapor/dashboard sahiplik/paylaşım kontrolü) ekle
- [x] SAP/Excel import sayı ayrıştırma hatasını düzelt (locale-aware decimal/thousand separator parsing) — `api/integrations/import/route.ts`, `api/upload/route.ts`
- [x] Hiyerarşi döngü koruması: `api/members/[id]/route.ts` PATCH'te yeni parent'ın mevcut torunlardan biri olup olmadığını kontrol et
- [x] Basit rate limiting middleware (login, AI query, export uçları için token-bucket/IP bazlı)
- [x] `api/users/[id]/route.ts` — "son admin" kontrolünü transaction içine al (TOCTOU fix)

## Faz 1 — Kısa Vade (≈1 ay, 2 sprint × 2 hafta)

### Sprint 1.1 (hafta 1-2) — hızlı kazanımlar & altyapı temizliği

- [x] React Compiler lint borcu temizliği (`eslint-plugin-react-hooks` v7: set-state-in-effect, static-components, immutability) — `admin/users/page.tsx`, `reports/page.tsx`, `DashboardWidget.tsx`, `ReportView.tsx`, `Sidebar.tsx`
- [x] Model/rapor/dashboard silme işlemlerine cascade cleanup ekle (comments, dimension `owner_model_id` reset)
- [x] SQL `IN (...)` listelerini chunk'lama (999 parametre limiti için)
- [x] `getModelDims`/`/api/dimensions`/`/api/models` N+1 sorgu paternlerini optimize et (JOIN ile tekilleştir)
- [x] Dockerfile + docker-compose.yml oluştur
- [x] Temel DB yedekleme scripti (SQLite dosya snapshot + rotasyon)

### Sprint 1.2 (hafta 3-4) — veri katmanı & test altyapısı

- [x] Veritabanı geçiş değerlendirmesi: PostgreSQL'e geçiş planı (Drizzle ORM soyutlaması zaten mevcut) veya better-sqlite3 için async wrapper/connection pool — karar: `ARCHITECTURE_AUDIT.md` §6, şimdilik better-sqlite3'te kal, tetikleyici kriterler tanımlandı
- [x] `upsertFacts` (`lib/facts-write.ts`) satır-satır işlemi toplu (bulk) upsert'e çevir
- [x] `/api/pivot`, `/api/query` endpoint'lerine satır/sütun üst sınırı ekle — ⚠️ doğrulama (2026-06-10): üst sınır gerçekten var (`fact-filters.ts` `MAX_AGGREGATE_RESULT_ROWS=20000`, aşımda `pivot/route.ts`/`query.ts` `400 result_too_large` döner); **gerçek sayfalama kısmı eksik çıktı, ayrı madde olarak Sprint 2.3 (devam)'a taşındı** (bkz. aşağıda).
- [x] Test altyapısı kurulumu (Vitest/Jest) ve kritik modüller için birim testleri:
  - [x] `lib/formula.ts`
  - [x] `lib/pivot.ts`
  - [x] `lib/access.ts`
  - [x] `lib/facts-write.ts`
  - [x] `lib/query.ts`

## Faz 2 — Orta Vade (2-3 ay, 3 sprint × ~3 hafta)

### Sprint 2.1 — Workflow & senaryo yönetimi

- [x] Workflow/onay akışı (submit → review → approve → lock) veri modeli + UI
- [x] Senaryo/versiyon karşılaştırma ekranı (VERSION dimension üzerine kopyalama/compare UI)

### Sprint 2.2 — Audit, formül motoru & iş kuralları

- [x] Cell-level audit trail görünümü + rollback (undo) mekanizması
- [x] Formül motoruna gelişmiş fonksiyonlar: `IF`, zaman-serisi ofseti (`[ACCOUNT].PY`, `MOVAVG`) — ⚠️ doğrulama (2026-06-10): `IF`/`SUM`/`AVG`/`MIN`/`MAX` ve `.PY`/`.MOVAVG(n)` gerçekten çalışıyor (`lib/formula.ts`, `lib/time-offset.ts`); **`SUMIF` implemente edilmemiş çıktı, ayrı madde olarak Sprint 2.3 (devam)'a taşındı** (bkz. aşağıda).
- [x] İş kuralı (business rule) motoru — örn. "Bütçe negatif olamaz" tipi validasyonlar

### Sprint 2.3 — Entegrasyon, erişilebilirlik & bildirimler

- [x] Connector plugin mimarisi (DB'de connector config, dinamik kayıt — statik dizi yerine)

#### Sprint 2.3 (devam) — kalan + yarım kalan maddeler (⚠️ tek tek işlenecek, bkz. yukarıdaki ÇALIŞMA KURALI)

> Sıralama: önce commit'e girmemiş/yarım kalan küçük teknik borçlar (1-3), sonra orijinal Sprint 2.3'ün kalan 3 maddesi orijinal sırasıyla (4-6).

1. [x] a11y iyileştirmelerini bitir ve commit'e al — `src/lib/a11y.ts` (`useEscapeKey`/`useFocusTrap`) ile `MemberPicker`/`DrillModal` entegrasyonu zaten yazılmış ama commit'e girmemiş (`git status`); kalan iş: drag-and-drop alanlarına (`reports/page.tsx`, `dashboards/page.tsx`) klavye eşdeğeri eklemek, sonra commit. — ✅ tamamlandı (2026-06-10, commit `820c007`): `reports/page.tsx`'teki boyut sıralama alanına (`DimChip`/`DropZone`) ok tuşlarıyla taşıma eklendi (↑/↓ bölge içi sıralama, ←/→ bölgeler arası taşıma, `role="button"`+`tabIndex`+`aria-label`); `dashboards/page.tsx`/`DashboardWidget.tsx`'teki widget sıralamasına ◀/▶ klavye-erişilebilir butonları eklendi. Lint/typecheck/test (112/112)/build temiz.
2. [x] Formül motoruna `SUMIF` ekle — `lib/formula.ts`'e `SUMIF(aralık;koşul)` fonksiyonu (Sprint 2.2'den kalan tek eksik parça). — ✅ tamamlandı (2026-06-10, commit `347d0ae`): `SUMIF(kosul1;deger1;kosul2;deger2;...)` eklendi — bu DSL'de "range" kavramı olmadığından (formüller tek satırın skalar kolon değerleri üzerinde çalışır), Excel SUMIF'in bu modele uyarlanmış karşılığı kosul/değer ikilileri şeklinde tasarlandı. 11 yeni test (toplam 123). Lint/typecheck/build temiz.
3. [ ] `/api/pivot`, `/api/query`'ye gerçek sayfalama ekle — şu an sert üst sınır (`400 result_too_large`) var ama page/pageSize tabanlı gerçek sayfalama yok (Sprint 1.2'den kalan).
4. [ ] i18n'i tam kapsama al — export dosyaları (PPTX/Excel başlık/etiketler) ve tüm hata mesajları `getT()` üzerinden çözülecek şekilde güncellenmeli.
5. [ ] Bildirim sistemi (yorum/mention, onay bekleyen görev) — en azından in-app, sonra e-posta.
6. [ ] Zamanlanmış veri yenileme (cron/webhook ile SAP OData senkronizasyonu).

## Faz 3 — Uzun Vade (3-6 ay, 3 sprint × ~6-8 hafta)

> **Not:** Aşağıdaki 3 sprintin madde sırası, bu oturumda basitten karmaşığa / düşük riskliden yüksek riskliye göre yeniden düzenlendi (orijinal sıra mimari bağımlılık/karmaşıklık gözetmiyordu). Her sprint kendi içinde yukarıdaki ÇALIŞMA KURALI'na göre tek tek işlenecek.

### Sprint 3.1 — Kimlik & çoklu-tenant

1. [ ] 2FA desteği — kullanıcı başına TOTP secret + login'de doğrulama; kendi içinde kapalı, şema/erişim modelini geniş çaplı etkilemiyor (grubun en basiti).
2. [ ] SSO entegrasyonu (SAML/OAuth2/Okta/Azure AD) — harici IdP ile login akışı + otomatik kullanıcı provisioning; 2FA'dan sonra orta karmaşıklık.
3. [ ] Çoklu-tenant / organizasyon desteği — tüm tablolara `tenant_id`, tüm sorgu/route/erişim kontrolü katmanının gözden geçirilmesi; en mimari-invaziv iş, bu grupta en sona bırakıldı.

### Sprint 3.2 — Gerçek zamanlı & performans

1. [ ] Büyük pivot tabloları için sanal kaydırma (virtualized grid — `PivotGrid.tsx`) — sadece frontend, backend bağımlılığı yok; grubun en basiti.
2. [ ] Sunucu taraflı caching (Redis) katmanı — altyapı eklentisi, mevcut sorgulara cache katmanı; virtualized grid'den sonra.
3. [ ] Gerçek zamanlı collaboration (WebSocket, eşzamanlı düzenleme kilidi/optimistic concurrency) — grubun en karmaşığı (concurrency/conflict yönetimi), Redis katmanı hazır olduktan sonra yapılması daha kolay.

### Sprint 3.3 — AI, mobil & dış entegrasyon

1. [ ] Harici BI araçlarına veri köprüsü (REST/OData export API — Power BI/Tableau bağlantısı) — kendi içinde kapalı, yeni bir API yüzeyi eklemek; grubun en basiti.
2. [ ] Mobil/responsive dashboard, PWA desteği — orta karmaşıklıkta frontend işi.
3. [ ] Anomali tespiti / AI destekli öngörü (forecast) modülü — veri bilimi/model bağımlılığı olan en karmaşık/riskli iş, bu grupta en sona bırakıldı.


---

## Must-Have Özellik Listesi (Kurumsal Planlama Araçlarıyla Kıyaslama)

> Anaplan / SAP BPC / SAP Analytics Cloud / Oracle EPM gibi araçlarda standart olup PlanRep'te eksik olan özellikler.

| # | Özellik | Gerekçe | Benzer araç örneği | Faz |
|---|---|---|---|---|
| 1 | Workflow / Onay akışı (submit→review→approve→lock) | **Tamamlandı (Sprint 2.1)** | Anaplan, SAP BPC "data lock" | Faz 2 |
| 2 | Versiyon/senaryo yönetimi (what-if) | **Tamamlandı (Sprint 2.1)** | SAP Analytics Cloud, Anaplan | Faz 2 |
| 3 | Audit trail + cell-level undo/redo | **Tamamlandı (Sprint 2.2)** | Anaplan "Version compare" | Faz 2 |
| 4 | Eşzamanlılık kilidi / optimistic concurrency | Row-locking yok | Excel Online, Google Sheets | Faz 3 |
| 5 | Satır-seviyesi güvenlik UI'ı iyileştirmesi | Granülerlik ve denetim arayüzü eksik | SAP BPC "Data Access Profiles" | Faz 2 |
| 6 | Zamanlanmış/otomatik SAP senkronizasyonu | Şu an manuel preview/import | Power BI "scheduled refresh" | Faz 2 |
| 7 | Test altyapısı + CI/CD + versiyon kontrolü | Üretim güvenilirliği için olmazsa olmaz | — | Faz 0/1 |
| 8 | Yedekleme/Disaster Recovery stratejisi | Tek SQLite dosyası, yedekleme yok | — | Faz 1 |
| 9 | Bildirim sistemi (yorum/mention, onay bekleyen görev) | Yorum var, bildirim/mail yok | Tüm BI araçları | Faz 2 |
| 10 | Gelişmiş formül fonksiyonları (IF, SUMIF, zaman-ofseti) | **Tamamlandı (Sprint 2.2 + 2.3 devam)** | Excel, Anaplan formula engine | Faz 2 |
| 11 | Veri doğrulama / business rules | **Tamamlandı (Sprint 2.2)** | Tüm EPM araçları | Faz 2 |
| 12 | API rate limiting + input sanitization tutarlılığı | Güvenlik borcu | — | Faz 0 |

## Nice-to-Have Özellik Listesi

| Kategori | Özellik | Faz |
|---|---|---|
| Raporlama | Çapraz-sekme grafiklerini PDF export, zamanlanmış rapor e-postası, rapor şablon kütüphanesi | 2-3 |
| Dashboard | Sürükle-bırak grid layout, gerçek zamanlı widget yenileme, mobil responsive görünüm | 3 |
| Collaboration | @mention bildirimleri, canlı imleç (Figma-style), değişiklik geçmişi diff görünümü | 3 |
| AI | Doğal dil ile veri yazma ("Ocak bütçesini %5 artır"), anomali tespiti, çoklu dil NLP | 3 |
| Entegrasyon | Dinamik connector plugin, OAuth2/SAML SSO, genel REST API, webhook tetikleyiciler | 2-3 |
| Performans | Redis caching, PostgreSQL + read-replica, sanal kaydırma (virtualized grid) | 1-3 |
| UX | Dark mode, klavye kısayolları, hücre düzeyinde undo/redo (Ctrl+Z), PWA/offline-first | 2-3 |
| Güvenlik | 2FA, SSO/Okta/Azure AD, IP allowlist, refresh token yönetimi | 3 |
| DevOps | Dockerfile + docker-compose, GitHub Actions CI, otomatik DB migration genişletmesi (Drizzle Kit) | 0-1 |

---

## Notlar

- Her madde tamamlandığında ilgili commit/PR referansını buraya ekleyin.
- Yeni bulunan teknik borç/özellik istekleri bu dosyaya (ilgili faza) eklenmeli; mimari gerekçe gerekiyorsa `ARCHITECTURE_AUDIT.md` güncellenmeli.
- Öncelik sırası değişebilir; iş değeri yüksek ama efor düşük maddeler (örn. rate limiting, Zod validation, cascade cleanup) Faz 0/1'de tutulmalı.

### Faz 0 tamamlama notu (2026-05-10)

- `middleware.ts` → `proxy.ts` migrasyonu yapıldı (Next.js 16 bu dosyayı deprecate etti; eski isimle Edge runtime'da kalıyordu ve `JWT_SECRET` fallback'i için eklenen `node:crypto` Edge'de desteklenmiyordu — build uyarısı bunu ortaya çıkardı).
- **Bilinen, bu çalışmanın kapsamı dışında kalan lint borcu:** `npm run lint` şu an aşağıdaki dosyalarda `eslint-plugin-react-hooks` v7 "React Compiler" kurallarından (set-state-in-effect, static-components, immutability) kaynaklanan, önceden var olan hatalarla başarısız oluyor — bu dosyalara bu oturumda dokunulmadı:
  - `src/app/(app)/admin/users/page.tsx`
  - `src/app/(app)/reports/page.tsx` (DropZone komponenti render içinde tanımlanıyor)
  - `src/components/DashboardWidget.tsx`
  - `src/components/ReportView.tsx`
  - `src/components/Sidebar.tsx`
  - `next build` bu kuralları çalıştırmıyor (build başarılı), yalnızca `npm run lint`/CI'daki lint adımı kırmızı çıkıyor. Faz 1'e "React Compiler lint borcu temizliği" olarak eklenmeli.

### Sprint 2.1 tamamlama notu (2026-06-10)

- Yeni tablolar: `workflow_items` (status: draft→submitted→in_review→approved→locked, scope `scope_filters` JSON Record<dimCode,string[]>), `workflow_history` (append-only geçiş günlüğü). `src/lib/workflow.ts` durum makinesini (`canTransition`/`applyTransition`) ve kilit kontrolünü (`findBlockingLock`, `findBlockingLockForFilters`) içerir.
- **Veri kilidi gerçek zamanlı uygulanıyor:** `locked` durumundaki bir workflow'un kapsamına giren koordinatlara `upsertFacts` (dolayısıyla `/api/upload`, `/api/integrations/import`, `/api/scenario/copy`) `WorkflowLockError` fırlatır → route'lar `423 Locked` döner. `/api/facts` DELETE da kesişim kontrolü yapar.
- Senaryo kopyalama (`/api/scenario/copy`) VERSION tipi bir boyuttaki bir üyenin verisini başka bir üyeye kopyalar; sonuç normal bir `uploads` kaydı olarak loglandığından mevcut `/api/uploads/[id]/revert` ile geri alınabilir.
- Karşılaştırma ekranı (`/scenarios`) ekstra backend gerektirmedi — VERSION zaten normal bir boyut olduğundan mevcut `/api/query` (colDim=VERSION) birebir kullanıldı, sadece fark/yüzde kolonları client-side eklendi.
- `/workflow` (liste+oluşturma) ve `/workflow/[id]` (detay, durum geçiş butonları, geçmiş) sayfaları eklendi; nav + i18n güncellendi.
- 12 yeni birim test (`workflow.test.ts`) + `facts-write.test.ts`'e 2 kilit senaryosu eklendi (toplam 61 test). Ayrıca gerçek `next dev` sunucusuna karşı tam döngü (submit→review→approve→lock→kilitli-kopyalama-reddi) manuel API smoke testiyle doğrulandı.
- **Bilinen sınırlama:** `revertUpload` kilit kontrolünden geçmiyor (bir upload'ı geri almak, o veriyi sonradan kilitleyen bir workflow'u göz ardı edebilir) — kapsam dışı bırakıldı, gelecekte ele alınmalı.

### Sprint 2.2 tamamlama notu (2026-06-10)

- **Hücre bazlı audit trail + rollback:** Yeni `fact_audit` tablosu (model_id, upload_id, d1..d8, old_value, new_value, source: write/revert/rollback, user_id, created_at). `upsertFacts`/`revertUpload` (`lib/facts-write.ts`) her satır için otomatik `fact_audit` kaydı üretir (toplu INSERT, `logFactAuditBulk`). `lib/fact-audit.ts`: `listFactAudit` (model/koordinat/upload filtresi), `rollbackFactAudit` (eski değer varsa `upsertFacts` ile geri yazar — lock/business-rule kontrolünden geçer; eski değer yoksa satırı siler ve `rollback` kaynaklı yeni bir audit kaydı oluşturur). `/api/fact-audit` (liste) + `/api/fact-audit/[id]/rollback` (geri alma) route'ları, `/admin/audit/cells` sayfası (filtre + geri al butonu); `/admin/audit` ana sayfasına link eklendi.
- **Formül motoru genişletildi** (`lib/formula.ts`): `IF(kosul;evet;hayır)` (karşılaştırma operatörleri `> < >= <= = <>`), `SUM/AVG/MIN/MAX(...)` fonksiyonları, iç içe IF desteği. **Önemli tasarım kararı:** fonksiyon argüman ayracı `;` (noktalı virgül) — tr-TR ondalık virgülüyle (`1,5`) çakışmaması için (Excel'in `tr-TR` locale'indeki `EĞER`/`;` konvansiyonuyla aynı). Zaman-serisi ofseti (`.PY` önceki yıl, `.MOVAVG(n)` hareketli ortalama) ayrı bir modülde (`lib/time-offset.ts`) `Getter` sarmalayıcı olarak uygulandı — formül motorunun kendisi dimension/TIME formatından habersiz kalır, sarmalayıcı `YYYY`/`YYYY-MM` kod formatını çözer. `report-types.ts` (`computeCalcCells`) ve `ReportView.tsx` (`calcRowsComputed`) bu sarmalayıcıyı kullanacak şekilde güncellendi. Reports sayfasına güncel sözdizimi ipucu eklendi.
- **İş kuralı (business rule) motoru:** Yeni `business_rules` tablosu (model_id, scope_filters JSON, op, value, severity: block/warn, message, active). `lib/business-rules.ts`: CRUD + `evaluateBusinessRules` (kapsam eşleşmesi için `workflow.ts` ile aynı `scopeMatchesCoord` yardımcısını — artık `lib/fact-filters.ts`'e taşınmış ortak bir fonksiyon — kullanır). `upsertFacts` her satır için hem lock hem business-rule kontrolü yapar: `block` şiddetindeki ihlal `BusinessRuleError` fırlatır (hiçbir şey yazılmaz), `warn` şiddetindekiler `UpsertFactsResult.warnings` içinde döner ve yazma işlemini durdurmaz. `/api/upload`, `/api/integrations/import`, `/api/scenario/copy` → `BusinessRuleError`'ı `400 business_rule_violated` olarak dönüyor ve `warnings` alanını response'a ekliyor. Kural yönetim UI'ı ayrı bir sayfa değil, `modeling/models/[id]/page.tsx` model detay sayfasına gömülü (CRUD + aktif/pasif toggle).
- `lib/fact-filters.ts`'e ortak `scopeMatchesCoord`/`scopesOverlap` yardımcıları eklendi; `workflow.ts`'teki kilit kontrolü de bunları kullanacak şekilde refactor edildi (kod tekrarı önlendi).
- 24 yeni birim test: `business-rules.test.ts` (10), `time-offset.test.ts` (8), `formula.test.ts`'e 15 yeni test (IF/SUM/AVG/MIN/MAX), `facts-write.test.ts`'e 6 yeni test (business-rule block/warn, fact_audit write/revert kayıtları) — toplam **100 test**. Gerçek `next dev` sunucusuna karşı manuel smoke testle doğrulandı: business-rule CRUD, scenario-copy → fact_audit kaydı → rollback tam döngüsü, ve bir `block` kuralının scenario-copy'yi `400` ile reddettiği (ilk denemede mesaj tekrarlıydı, `BusinessRuleError` kural-id'ye göre dedupe edilerek düzeltildi) doğrulandı; `/workflow`, `/scenarios`, `/admin/audit/cells`, `/modeling/models/[id]`, `/reports` sayfalarının hepsi 200 döndü.

### Sprint 2.3 — Connector plugin mimarisi tamamlama notu (2026-06-10)

- Yeni `connector_configs` tablosu (type, name, config JSON, active). `lib/connectors/types.ts`'e `ConnectorTypeDef` (configFields + `create(config)` fabrikası) eklendi; `sap-mock.ts`/`sap-odata.ts` artık hem geriye-dönük uyumlu statik tekil `Connector` örneğini (env değişkenlerinden, eski davranış) hem de `ConnectorTypeDef`'i export ediyor.
- `lib/connector-configs.ts`: CRUD + `seedConnectorConfigsFromEnv()` — modül yüklendiğinde bir kez çalışır, hiç kayıt yoksa `SAP_ODATA_URL`/`SAP_USER`/`SAP_PASS` ortam değişkenleri tanımlıysa otomatik bir `sap-odata` config'i oluşturur (mevcut `.env.local` tabanlı kurulumlar yeni sisteme sorunsuz geçer), ayrıca her zaman bir `sap-mock` config'i ekler.
- `lib/connectors/index.ts` artık statik `connectors[]`/`getConnector(id)` yerine `CONNECTOR_TYPES` (kod-seviyesi tür kaydı) + `listConnectorInstances()`/`getConnectorInstance(configId)` (DB'deki aktif config'lerden canlı `Connector` örnekleri üretir) sunuyor.
- API: `/api/connector-configs` (liste — credential alanları maskeli döner, oluşturma), `/api/connector-configs/[id]` (güncelleme/silme/test), `/api/connector-configs/types` (UI'nin form alanlarını dinamik oluşturması için tür metadata'sı). Mevcut `/api/integrations`, `/api/integrations/preview`, `/api/integrations/import` route'ları `connectorId: string` yerine `connectorId: number` (config id) kullanacak şekilde güncellendi.
- UI: Entegrasyonlar sayfasına (`integrations/page.tsx`) admin-only "Bağlantıları Yönet" paneli eklendi (bağlantı listesi + test et/aktif-pasif/sil + yeni bağlantı formu, seçilen türe göre dinamik alan listesi).
- 12 yeni birim test (`connector-configs.test.ts`) — toplam **112 test**. `npm run lint`/`tsc`/`next build` temiz; gerçek `next dev` sunucusuna karşı manuel doğrulama yapıldı (connector listesi, config CRUD akışları render/API seviyesinde çalışıyor).
