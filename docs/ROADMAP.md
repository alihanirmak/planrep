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
> **Sprint 3.1 tamamlandı (2026-06-10):** 2FA/TOTP, SSO/OIDC ve çoklu-tenant desteği (sırasıyla) bitirildi — Sprint 3.1'in tamamı artık `[x]`.

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
3. [x] `/api/pivot`, `/api/query`'ye gerçek sayfalama ekle — şu an sert üst sınır (`400 result_too_large`) var ama page/pageSize tabanlı gerçek sayfalama yok (Sprint 1.2'den kalan). — ✅ tamamlandı (2026-06-10, commit `c35e04c`): `lib/model.ts`'e `rootMembers()` eklendi; `runQuery`/`/api/pivot` route'una opsiyonel `page`/`pageSize` parametresi eklendi — ilk satır boyutunun kök üyeleri sayfalanır, her sayfaya seçilen kök üyenin TÜM alt ağacı dahil edilerek rollup toplamları her zaman doğru hesaplanır (colTotals/grandTotal sadece o sayfanın verisini yansıtır, dokümante edilmiş tutarlı bir semantik). Parametre verilmezse davranış tamamen eskisiyle aynı (geriye dönük uyumlu, mevcut çağıranlar etkilenmedi). 5 yeni test (toplam 128). Lint/typecheck/build temiz.
4. [x] i18n'i tam kapsama al — export dosyaları (PPTX/Excel başlık/etiketler) ve tüm hata mesajları `getT()` üzerinden çözülecek şekilde güncellenmeli. — ✅ tamamlandı (2026-06-10, commit `2cdd86c`): `lib/i18n-server.ts` (sunucu tarafı locale çözümleme — `next/headers` client component'leri bozmasın diye ayrı dosyada), `formatT()`/`intlLocale()` eklendi. Excel/PPTX export'taki "Genel Toplam"/"Rapor" ve PPTX'in sabit `tr-TR` sayı/tarih formatı artık oturum locale'ine göre; 9 API route'taki kullanıcıya doğrudan gösterilen hardcoded Türkçe `message` alanları (pivot/query sonuç-çok-büyük, workflow, facts, members, models, dimensions, ai/query, integrations) i18n'e taşındı. 9 yeni test (toplam 137). Lint/typecheck/build temiz. Not: makine-okunur `error` kodları (örn. `"unauthorized"`) kapsam dışı — sadece kullanıcıya gösterilen metinler kapsandı.
5. [x] Bildirim sistemi (yorum/mention, onay bekleyen görev) — en azından in-app, sonra e-posta. — ✅ tamamlandı (2026-06-10, commit `60fc6fd`): `notifications` tablosu + `lib/notifications.ts` (CRUD, bulk create, `resolveMentionedUserIds` ile Unicode-aware @mention çözümleme). Tetikleyiciler: yorum → entity sahibi + mention edilenler; workflow submit/approve/reject → onaylayan/sahip. `NotificationBell` komponenti (Sidebar'da zil ikonu, 30sn polling, dropdown liste, "tümünü okundu yap", a11y: focus-trap+ESC). Bildirim metinleri `notif.*` i18n anahtarları üzerinden gösterim anında alıcının locale'ine göre render ediliyor. `/reports`/`/dashboards`'a `?id=` deep-link desteği eklendi ki bildirim linkleri gerçekten bir şeye gitsin. E-posta kapsam dışı bırakıldı (madde metninde "sonra e-posta" olarak zaten ayrılmıştı) — ileride ayrı bir iş olarak ele alınabilir. 16 yeni test (toplam 153). Lint/typecheck/build temiz.
6. [x] Zamanlanmış veri yenileme (cron/webhook ile SAP OData senkronizasyonu). — ✅ tamamlandı (2026-06-10, commit `5b6e3b7`): `lib/integrations/run-import.ts`'e manuel import'un çekirdek mantığı (`runConnectorImport`) çıkarıldı — manuel ve zamanlanmış import AYNI kod yolunu kullanır. Yeni `scheduled_syncs` tablosu + `lib/scheduled-sync.ts` (CRUD, `runScheduledSync`, `findDueScheduledSyncs`/`runDueScheduledSyncs`). **Mimari karar:** uygulama içinde arka plan zamanlayıcı (`setInterval`) yok — bunun yerine `POST /api/cron/sync` webhook ucu eklendi; harici bir cron (OS crontab, k8s CronJob, GitHub Actions scheduled workflow) bunu `X-Cron-Secret` header'ıyla periyodik çağırır (`CRON_SECRET` tanımlı değilse uç kasıtlı olarak 503 döner — varsayılan açık/korumasız bırakılmaz). Admin UI: `integrations/page.tsx`'e "Zamanlanmış Senkronizasyonlar" paneli + mevcut önizleme/eşlemeyi "Zamanlanmış Hale Getir" formu. `docker-compose.yml`'e `CRON_SECRET` eklendi. 12 yeni test (toplam 165). Lint/typecheck/build temiz.

**Sprint 2.3 (devam) tamamlandı — Sprint 2.3'ün ve Faz 2'nin tamamı artık bitmiş durumda.**

## Faz 3 — Uzun Vade (3-6 ay, 3 sprint × ~6-8 hafta)

> **Not:** Aşağıdaki 3 sprintin madde sırası, bu oturumda basitten karmaşığa / düşük riskliden yüksek riskliye göre yeniden düzenlendi (orijinal sıra mimari bağımlılık/karmaşıklık gözetmiyordu). Her sprint kendi içinde yukarıdaki ÇALIŞMA KURALI'na göre tek tek işlenecek.

### Sprint 3.1 — Kimlik & çoklu-tenant

1. [x] 2FA desteği — kullanıcı başına TOTP secret + login'de doğrulama; kendi içinde kapalı, şema/erişim modelini geniş çaplı etkilemiyor (grubun en basiti). — ✅ tamamlandı (2026-06-10, bu oturumda doğrulandı, henüz commit edilmedi — proje git repo değil): `users` tablosuna `totp_secret`/`totp_enabled`/`totp_backup_codes` kolonları eklendi (`lib/db/schema.ts`). `lib/totp.ts` bağımlılıksız RFC 6238/4226 (HOTP/TOTP, base32, otpauth:// URI, bcrypt'li yedek kurtarma kodları) implementasyonu; `lib/totp-user.ts` DB işlemleri (setup/enable/disable/backup code tüketimi, TOCTOU-güvenli). `/api/auth/totp/{setup,enable,disable,status}` + login akışına ikinci adım `/api/auth/login/totp` (pre-auth JWT ile köprülenmiş — `lib/session.ts` `PREAUTH_COOKIE`). UI: `login/page.tsx` iki adımlı form, `account/security/page.tsx` kurulum/devre dışı bırakma ekranı, Sidebar'a nav linki. i18n (`security.*`, `login.totp*`) tam kapsamlı. 16 yeni test (`totp.test.ts`) — toplam **181 test**, hepsi geçiyor. Lint (0 hata, 2 ön-var olan ilgisiz uyarı)/typecheck/build hepsi temiz.
2. [x] SSO entegrasyonu (SAML/OAuth2/Okta/Azure AD) — harici IdP ile login akışı + otomatik kullanıcı provisioning; 2FA'dan sonra orta karmaşıklık. — ✅ tamamlandı (2026-06-10): SAML yerine **OIDC** (Authorization Code + PKCE) implemente edildi — gerekçe: Okta/Azure AD ikisi de OIDC'yi tam destekliyor, `jose` zaten bağımlılık (SAML için ağır XML imzalama kütüphanesi eklemek gerekmezdi); SAML kapsam dışı bırakıldı, gerekirse ayrı bir iş. `users` tablosuna `sso_provider`/`sso_subject`/`auth_provider` kolonları. `lib/sso/{config,pkce,oidc-client,sso-user}.ts`: env tabanlı yapılandırma (OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET tanımlı değilse SSO devre dışı — varsayılan açık bırakılmaz), PKCE (S256), discovery+JWKS doğrulamalı OIDC istemcisi, provisioning mantığı (sub ile eşleşme → email ile mevcut kullanıcıya bağlama → yeni kullanıcı oluşturma, `SSO_DEFAULT_ROLE`). `/api/auth/sso/{login,callback,status}` — state/nonce/codeVerifier imzalı kısa ömürlü cookie'de taşınıyor (sunucu taraflı session store yok). UI: login sayfasına koşullu SSO butonu, account/security sayfasına "bu hesap X ile giriş yapıyor" notu. i18n tam kapsamlı. `.env.example`/`docker-compose.yml` güncellendi. 29 yeni test (`sso/*.test.ts`) — toplam **210 test**. Lint (0 hata)/typecheck/build hepsi temiz.
3. [x] Çoklu-tenant / organizasyon desteği — tüm tablolara `tenant_id`, tüm sorgu/route/erişim kontrolü katmanının gözden geçirilmesi; en mimari-invaziv iş, bu grupta en sona bırakıldı. — ✅ tamamlandı (2026-06-10): **Mimari karar — "doğrudan + transitive" karma izolasyon**: `tenant_id` kolonu sadece raw id ile aranan ÜST SEVİYE kaynaklara eklendi (`users`, `models`, `dimensions`, `reports`, `dashboards`, `workflow_items`, `business_rules`, `connector_configs`, `scheduled_syncs`) + yeni `tenants` tablosu. `facts`/`uploads`/`comments`/`notifications`/`fact_audit`/`workflow_history`/`user_dim_access` gibi ÇOCUK tablolara kasıtlı olarak `tenant_id` eklenmedi — izolasyonları her zaman ebeveyn kaynağın (`model_id`/entity sahipliği) tenant kontrolünden GEÇTİKTEN SONRA sağlanır ("transitive" izolasyon); bu, her yazma yolunda tenant_id kopyalamaktan kaynaklanabilecek tutarsızlık riskini azaltır ve `facts` EAV tablosuna (zaten d1..d8 sabit kolon limiti var) yeni kolon eklemekten kaçınır. Ayrı bir "superadmin" rolü YOK — her tenant kendi admin'ini self-service `/signup` (`/api/auth/signup`) akışıyla oluşturur (yeni tenant + ilk admin kullanıcı, otomatik oturum açar). `email` kolonu kasıtlı olarak hâlâ GLOBAL benzersiz (tenant'lar arası da) — basit bir sınırlama olarak dokümante edildi, aynı email farklı tenant'larda ayrı hesap açamaz. `lib/model.ts`'e `getModelTenantId`/`getDimensionTenantId` yardımcıları eklendi (route'ların raw id doğrulaması için — 403 değil kasıtlı olarak 404 döner, başka bir tenant'a ait kaynağın VAR OLDUĞUNU bile sızdırmamak için). **~30 route dosyası + 7 lib dosyası** tek tek gözden geçirilip güncellendi (models/dimensions/reports/dashboards/workflow/business-rules/connector-configs/scheduled-syncs/facts/pivot/query/upload/uploads/scenario-copy/fact-audit/comments/users/integrations + admin/audit sayfası). **Kritik güvenlik düzeltmesi (bu geçiş sırasında bulundu):** `canAccessCommentEntity` (`lib/access.ts`) tenant kontrolünden ÖNCE admin kısayolu yapıyordu — bir tenant'ın admin'i başka bir tenant'ın paylaşılan/özel raporuna id tahmin ederek erişebilirdi; sıra değiştirildi (tenant kontrolü her zaman önce). Ayrıca `/api/auth/sso/*` ve yeni `/signup`+`/api/auth/signup` `proxy.ts`'teki `PUBLIC_PATHS`'e eklendi (SSO girişi bu düzeltmeden önce fiilen hiç çalışmıyordu — middleware önce 401 dönüyordu, önceki SSO oturumundan kalan bir hataydı, bu oturumda fark edilip düzeltildi). `resolveMentionedUserIds` (@mention çözümleme) artık tenant'a göre filtreleniyor (önceden tüm kullanıcıları tariyordu). `/api/users` ve "son admin" koruması (`adminCountSync`) tenant bazlı hale getirildi. 9 yeni test (`tenant.test.ts`, `model.test.ts`, `access.test.ts`'e cross-tenant admin testi) — toplam **219 test**. Lint (0 hata)/typecheck/build hepsi temiz.

### Sprint 3.2 — Gerçek zamanlı & performans

1. [x] Büyük pivot tabloları için sanal kaydırma (virtualized grid — `PivotGrid.tsx`) — sadece frontend, backend bağımlılığı yok; grubun en basiti. — ✅ tamamlandı (2026-06-10): Harici kütüphane eklenmedi (bkz. `lib/totp.ts`'teki benzer "bağımlılık yüzeyini büyütme" kararı) — satır sanallaştırma matematiği saf, DOM'dan bağımsız bir fonksiyonda (`lib/virtualize.ts` `computeVirtualRange`) implemente edildi; bu sayede proje test altyapısının jsdom/@testing-library içermemesine rağmen (`vitest.config.ts` `environment: "node"`) gerçek birim testlerle (9 test) doğrulanabildi. `PivotGrid.tsx` toplam satır sayısı (veri + hesaplanan satırlar) 80'i aştığında otomatik olarak devreye girer — eşiğin altındaki (çoğu) rapor DOM'u birebir eskisi gibi render edilir, görsel regresyon riski yok. Sanallaştırma aktifken: konteyner dikey olarak `max-h-[70vh]` ile kırpılır, scroll pozisyonuna göre sadece görünür satır aralığı (+ üstte/altta overscan) render edilir, üstte/altta boşluk (`spacer`) `<tr>`'leri gerçek scroll yüksekliğini korur, gerçek satır yüksekliği ilk satırdan callback-ref ile ölçülür (React Compiler'ın "ref'e render sırasında erişilemez" kuralına uymak için `useRef`+`useLayoutEffect` yerine kasıtlı olarak callback-ref deseni kullanıldı). Ek katma değer: başlık satırı (`sticky top-0`) ve "Genel Toplam" satırı (`sticky bottom-0`) artık sanallaştırma aktifken her zaman görünür kalıyor (büyük tablolarda gezinme kolaylığı). 9 yeni test (`virtualize.test.ts`) — toplam **228 test**. Lint (0 hata — bu arada React Compiler ref kuralı ihlali bulunup düzeltildi)/typecheck/build hepsi temiz.
2. [x] Sunucu taraflı caching (Redis) katmanı — altyapı eklentisi, mevcut sorgulara cache katmanı; virtualized grid'den sonra. — ✅ tamamlandı (2026-06-10): `ioredis` bağımlılığı eklendi (bu seferkine, 2FA/SSO/virtualize'daki "harici bağımlılık ekleme" kaçınma kararının aksine — gerekçe: Redis protokolünü sıfırdan implemente etmek anlamsız olurdu, bu TOTP/PKCE gibi "kendi başımıza basit implemente edilebilir" bir şey değil). Mimari karar: `REDIS_URL` tanımlıysa gerçek Redis'e bağlanır, tanımlı değilse (veya bağlantı başarısız olursa) OTOMATIK OLARAK bellek-içi (in-process, `rate-limit.ts` ile aynı desen) fallback'e düşer — caching bir GÜVENLİK özelliği değil SADECE performans katmanı olduğundan, `CRON_SECRET`/SSO'daki "tanımlı değilse devre dışı" yaklaşımı burada YANLIŞ olurdu; varsayılan (Redis'siz) kurulumda da gerçek bir performans kazancı sağlanır. `lib/cache.ts`: `cacheGet`/`cacheSet`/`cacheDeleteByPrefix`/`cached()` (fonksiyon sonucu cache'leyen sarmalayıcı) + `hashCacheParams` (filtre/sayfalama nesnelerinden deterministik, anahtar-sırasından bağımsız cache key üretir). `/api/pivot` ve `/api/query` (en ağır GROUP BY/SUM sorguları) 60sn TTL ile cache'lendi — anahtar `session.id`'yi de içeriyor çünkü sonuç kullanıcının veri erişim kısıtlarına (`allowedSets`) göre değişir, iki kullanıcının farklı görebileceği sonuçları yanlışlıkla paylaşmamak için. Yazma yollarında (`upsertFacts`/`revertUpload`, dolayısıyla upload/scenario-copy/integration-import/fact-audit-rollback) modelId bazlı anlık invalidation (`cacheDeleteByPrefix`) eklendi — TTL'nin dolmasını beklemeden veri değişikliği hemen yansır. `docker-compose.yml`'e opsiyonel `redis` servisi (`--profile cache` ile açılır) + `.env.example`'a `REDIS_URL`. Gerçek `next dev` sunucusuna karşı manuel doğrulama: ilk `/api/query` çağrısı 352ms, aynı parametrelerle ikinci çağrı (cache'ten) 24ms, sonuçlar birebir aynı. 12 yeni test (`cache.test.ts`, REDIS_URL tanımsızken bellek-içi fallback yolunu kapsar) — toplam **240 test**. Lint (0 hata)/typecheck/build hepsi temiz.
3. [x] Gerçek zamanlı collaboration (WebSocket, eşzamanlı düzenleme kilidi/optimistic concurrency) — grubun en karmaşığı (concurrency/conflict yönetimi), Redis katmanı hazır olduktan sonra yapılması daha kolay. — ✅ tamamlandı (2026-06-10): **Mimari karar — WebSocket DEĞİL, optimistic concurrency + polling**: bu proje `next start` ile dağıtılan standart bir Next.js App Router uygulaması; kalıcı bir WebSocket sunucusu eklemek (ayrı bir process, sticky-session/load-balancer gereksinimi, serverless uyumsuzluğu) mevcut dağıtım modelini kökten değiştirirdi ve projenin "gereksiz altyapı/bağımlılık ekleme" prensibiyle çelişirdi (bkz. 2FA/SSO/virtualize kararları). Mevcut kod tabanında da WebSocket/SSE altyapısı YOKTU (incelendi, doğrulandı) — tek "canlı güncelleme" idiomu `NotificationBell.tsx`'teki basit `setInterval` polling'di; bu çözüm o deseni genişletir. `reports`/`dashboards` tablolarına `version` kolonu eklendi (her PUT'ta +1). `lib/version-guard.ts`: paylaşılan `versionedUpdate()` yardımcısı — istemci `expectedVersion` gönderir, sunucudaki versiyonla uyuşmazsa (veya UPDATE'in `WHERE version = ?` koşulu 0 satır değiştirirse — nadir bir yarış durumu) `409 Conflict` + güncel kaydı döner, lost-update senaryosu engellenir. `lib/hooks/useVersionConflict.ts`: PUT→409'u `conflict` state'ine çeviren + 20sn'de bir arka planda `GET` ile versiyonu kontrol edip "başkası güncelledi" (`remoteUpdated`) bildirimi üreten paylaşılan client hook'u (owner olmayan/kaydedilmemiş kayıtlarda polling yapılmaz). `reports/page.tsx` ve `dashboards/page.tsx`'e entegre edildi: kaydet butonu artık `expectedVersion` gönderiyor, 409 durumunda sarı "çakışma" banner'ı (⚠️ "onların sürümünü yükle" / "benimkini üzerine yaz" seçenekleriyle, otomatik hiçbir şey YAPILMAZ), arka plan polling'den gelen bildirimde mavi "başkası güncelledi" banner'ı. Gerçek `next dev` sunucusuna karşı manuel doğrulama: doğru `expectedVersion` ile PUT → 200 (version 1→2), aynı (artık eski) `expectedVersion` ile ikinci PUT → 409 (current.version=2). 5 yeni test (`version-guard.test.ts`) — toplam **245 test**. Lint (0 hata — bu arada yine React Compiler ref kuralı ihlali bulunup düzeltildi, `useVersionConflict.ts`'te render sırasında ref yazma yerine effect içinde senkronizasyon)/typecheck/build hepsi temiz.

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
| 6 | Zamanlanmış/otomatik SAP senkronizasyonu | **Tamamlandı (Sprint 2.3 devam)** — webhook (`/api/cron/sync`) tabanlı, harici cron tetikler | Power BI "scheduled refresh" | Faz 2 |
| 7 | Test altyapısı + CI/CD + versiyon kontrolü | Üretim güvenilirliği için olmazsa olmaz | — | Faz 0/1 |
| 8 | Yedekleme/Disaster Recovery stratejisi | Tek SQLite dosyası, yedekleme yok | — | Faz 1 |
| 9 | Bildirim sistemi (yorum/mention, onay bekleyen görev) | **Tamamlandı (Sprint 2.3 devam, in-app)** — e-posta kapsam dışı | Tüm BI araçları | Faz 2 |
| 10 | Gelişmiş formül fonksiyonları (IF, SUMIF, zaman-ofseti) | **Tamamlandı (Sprint 2.2 + 2.3 devam)** | Excel, Anaplan formula engine | Faz 2 |
| 11 | Veri doğrulama / business rules | **Tamamlandı (Sprint 2.2)** | Tüm EPM araçları | Faz 2 |
| 12 | API rate limiting + input sanitization tutarlılığı | Güvenlik borcu | — | Faz 0 |

## Nice-to-Have Özellik Listesi

| Kategori | Özellik | Faz |
|---|---|---|
| Raporlama | Çapraz-sekme grafiklerini PDF export, zamanlanmış rapor e-postası, rapor şablon kütüphanesi | 2-3 |
| Dashboard | Sürükle-bırak grid layout, gerçek zamanlı widget yenileme, mobil responsive görünüm | 3 |
| Collaboration | @mention bildirimleri (**Tamamlandı — Sprint 2.3 devam**), canlı imleç (Figma-style), değişiklik geçmişi diff görünümü | 3 |
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
