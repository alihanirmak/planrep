# Oturum İlerleme Notları (yaşayan dosya — her oturumda güncellenir)

> Amaç: "kalınan yer" her zaman burada net olsun. Yeni bir oturuma başlarken önce bu dosyayı oku.

## Kalıcı kullanıcı tercihi (2026-06-10)

- **Git için onay istenmeyecek**: kullanıcı her commit/push öncesi onay akışını
  kaldırdı — her madde tamamlandığında (test/lint/typecheck/build yeşil
  olduktan sonra) commit+push otomatik yapılır, ayrıca sorulmaz.
- **Git kullanıcısı**: `alihanirmak` ile ilerlenecek (remote zaten
  `github.com/alihanirmak/planrep.git`).

## Nice-to-Have kalanları backlog'a taşındı + yeni dokümanlar (2026-06-10)

- Kullanıcı, kalan tüm Nice-to-Have maddelerinin (dark mode, sürükle-bırak
  grid, canlı imleç/diff, doğal dil veri yazma, PostgreSQL+read-replica,
  IP allowlist/refresh token, otomatik migration genişletmesi) **"Gelecek
  Yol Haritası (Backlog)"** bölümünde kalmasını istedi — hiçbiri şu an
  bir sprint'e bağlanmadı. `ROADMAP.md`'deki Nice-to-Have tablosu özet/referans
  haline getirildi, gerçek backlog listesi "Gelecek Yol Haritası" bölümünde.
- Kullanıcı ayrıca iki yeni doküman istedi:
  - `docs/GELISTIRME_OZETI.md` — tüm fazların/sprintlerin anlaşılır Türkçe
    özeti (ne yapıldı, rakamlarla özet, mimari felsefe, backlog listesi).
  - `docs/KULLANICI_KILAVUZU.md` — son kullanıcı için 17 bölümlük adım adım
    kullanım kılavuzu (giriş/2FA/SSO, modelleme, yükleme, veri gözatma +
    hücre düzenleme/undo-redo, raporlar + formül sözdizimi, dashboardlar,
    workflow, senaryolar, AI sorgu, entegrasyonlar, bildirimler, hesap
    güvenliği, admin ekranları, klavye kısayolları, PWA, SSS).

## Karmaşık hesaplama dili tartışması → backlog (2026-06-10)

- Kullanıcı sordu: bütçe planlamadaki karmaşık hesaplamalar (bordro, maliyet
  dağıtımı) için hangi dil konulmalı? İlk cevap ("mevcut DSL'i genişlet,
  genel-amaçlı dil gömme") eksik bulundu — kullanıcı BPC Script Logic/SAC
  Advanced Formula/ABAP exit örnekleriyle itiraz etti.
- Düzeltilmiş analiz: BPC/SAC'ta güç = (a) **sınırlı-kapsamlı** prosedürel
  DSL (döngü var ama boyut üyeleriyle sınırlı, Turing-complete değil) +
  (b) gerçek kod ama IT tarafından **deploy edilmiş**, kullanıcının canlı
  yazdığı değil. Bu ayrım PlanRep'e şöyle taşınabilir:
  1. Sınırlı-kapsamlı script motoru (FOR EACH MEMBER OF, ALLOCATE, iteratif
     yakınsama) — admin tanımlar, açık "Hesapla" eylemiyle tetiklenir.
  2. Eklenti mimarisi (`lib/connectors/`teki `ConnectorTypeDef` ile BİREBİR
     AYNI desen) — geliştirici TS fonksiyonu yazıp deploy eder, admin
     modele bağlar; kullanıcı asla canlı kod çalıştırmaz (sandbox VM
     güvenlik riski kasıtlı olarak reddedildi).
- Kullanıcı "sonra karar vereceğiz, backlog'a ekle" dedi → `ROADMAP.md`
  "Gelecek Yol Haritası" bölümüne detaylı madde olarak eklendi, henüz
  hiçbir sprint'e bağlanmadı.

## 2026-06-10 — Faz 3 / Sprint 3.1 madde 1 (2FA/TOTP) DOĞRULANDI

- Önceki oturumda (bu oturumun başlangıcında geçmişi görünmüyordu — proje git
  repo değil, konuşma geçmişi de taşınmamıştı) 2FA/TOTP işi zaten kod olarak
  tamamlanmış bulundu ama `ROADMAP.md`'de hâlâ `[ ]` işaretliydi ve commit
  edilmemişti. Bu oturumda kod tek tek incelendi ve çalıştırılarak doğrulandı:
  - `lib/db/schema.ts` (totp kolonları), `lib/totp.ts` (RFC 6238/4226),
    `lib/totp-user.ts`, `/api/auth/totp/*` + `/api/auth/login/totp`,
    `login/page.tsx` (2 adımlı form), `account/security/page.tsx`, i18n.
  - `npm test` → **181/181 test geçti** (16'sı `totp.test.ts`).
  - `tsc --noEmit` → temiz. `eslint` → 0 hata (2 ön-var olan ilgisiz uyarı).
  - `next build` → başarılı (3 pre-existing ilgisiz uyarı, TOTP ile ilgisiz).
  - `ROADMAP.md` Sprint 3.1 madde 1 `[x]` yapıldı, tamamlama notu eklendi.
- **Düzeltme:** İlk bakışta `C:\workspace\NTT PLA&REP` (dış klasör) git repo
  değildi diye yanlışlıkla orada `git init` çalıştırıldı — bu HATAYDI, hemen
  geri alındı (`.git` silindi). Gerçek repo `planrep/` klasörünün kendisi
  (origin: `github.com/alihanirmak/planrep.git`), 17 commit (`74086e9`
  initial'dan `669f395`'e kadar, origin/main'in **12 commit ilerisinde**,
  henüz push edilmemiş). ROADMAP/SESSION_NOTES'taki tüm commit hash'leri
  (`ec421f3`, `bfb05ed`, `3a6e4f2`, `e3da2a5`, `c64f453`, `820c007`,
  `347d0ae`, `c35e04c`, `2cdd86c`, `60fc6fd`, `5b6e3b7`, `669f395`) `git log`
  ile birebir doğrulandı. **2FA/TOTP (Sprint 3.1 madde 1) işi bu commit'lerin
  HİÇBİRİNDE yok — tamamen commit edilmemiş çalışma kopyası (working tree)
  değişikliği**, bu oturumun teşhisiyle tutarlı.
- Faz 0 "git repo'ya alma" maddesi fiilen doğru (`planrep/` içinde zaten
  git var) — önceki yanlış teşhis (dış klasöre bakıp "repo yok" denmesi)
  düzeltildi, ROADMAP'te değişiklik gerekmiyor.

## Sıradaki adım

- 2FA/TOTP commit edildi ve push edildi (`c76aeda`, origin/main güncel).
- SSO/OIDC commit edildi ve push edildi (`31efa9a`, origin/main güncel).
- Sprint 3.1 madde 3 (çoklu-tenant) bu oturumda implemente edildi — kullanıcı
  "uzun sürecekse parçalara ayırabilirsin" dediği için iş 9 alt-adıma bölündü
  (schema → session/signup → models/dimensions → reports/dashboards →
  workflow/business-rules → connector-configs/scheduled-syncs →
  facts/pivot/query/upload/scenario/fact-audit → comments/users → testler),
  her adımda typecheck+test ile ara doğrulama yapıldı.
  - Mimari karar: "doğrudan + transitive" karma izolasyon — `tenant_id`
    sadece üst seviye kaynaklara (`users/models/dimensions/reports/
    dashboards/workflow_items/business_rules/connector_configs/
    scheduled_syncs`) eklendi + yeni `tenants` tablosu; `facts/uploads/
    comments/notifications/fact_audit` gibi çocuk tablolar kendi
    `tenant_id`'sine sahip değil, ebeveyn kaynağın (`model_id`/entity
    sahipliği) tenant kontrolünden GEÇEREK (transitive) izole ediliyor.
  - Ayrı "superadmin" rolü yok — her tenant kendi admin'ini self-service
    `/signup` (`/api/auth/signup`) ile oluşturuyor.
  - **Bu geçiş sırasında bulunan ve düzeltilen kritik güvenlik açıkları**
    (önceki oturumlardan kalma, bu işin kapsamı dışında ama düzeltilmesi
    gerekliydi): `canAccessCommentEntity`'de admin kısayolu tenant
    kontrolünden ÖNCE geliyordu (cross-tenant veri sızıntısı riski) — sıra
    düzeltildi; `/api/auth/sso/*` + yeni `/signup` `proxy.ts` `PUBLIC_PATHS`
    listesinde YOKTU (SSO girişi fiilen hiç çalışmıyordu, middleware önce
    401 dönüyordu) — eklendi; `resolveMentionedUserIds` tüm kullanıcıları
    tenant filtresi olmadan tarıyordu — düzeltildi.
  - 9 yeni test (`tenant.test.ts`, `model.test.ts`, `access.test.ts`'e
    cross-tenant admin testi) — toplam **219 test**, hepsi geçiyor.
    Lint (0 hata)/typecheck/build hepsi temiz.
  - **Henüz commit edilmedi** — kullanıcı onayı bekleniyor.
- Sprint 3.1'in TÜMÜ (2FA + SSO + çoklu-tenant) artık tamamlandı.
  Sıradaki: Sprint 3.2 madde 1 (virtualized grid) için onay istenecek.
- Çoklu-tenant commit edildi ve push edildi (`51c9622`, origin/main güncel).
- Sprint 3.2 madde 1 (virtualized grid) bu oturumda implemente edildi:
  `lib/virtualize.ts` (`computeVirtualRange` — saf, DOM'suz sanallaştırma
  matematiği, 9 test) + `PivotGrid.tsx` entegrasyonu (80 satır eşiği,
  callback-ref ile satır yüksekliği ölçümü, sticky header/footer). Bu
  sırada React Compiler'ın "ref'e render sırasında erişilemez" kuralı
  ihlali bulunup düzeltildi (useRef+useLayoutEffect yerine callback-ref).
  Toplam **228 test**. Lint/typecheck/build temiz. **Henüz commit
  edilmedi** — kullanıcı onayı bekleniyor, sonra Sprint 3.2 madde 2
  (Redis caching) için onay istenecek.
- Virtualized grid commit edildi ve push edildi (`41548a1`, origin/main
  güncel).
- Sprint 3.2 madde 2 (Redis caching) bu oturumda implemente edildi:
  `ioredis` bağımlılığı eklendi (bu sefer harici bağımlılık ekleme
  kararı — Redis protokolünü kendimiz implemente etmek anlamsız olurdu),
  `lib/cache.ts` — `REDIS_URL` tanımlıysa gerçek Redis, tanımlı değilse
  OTOMATIK bellek-içi fallback (CRON_SECRET/SSO'nun aksine "varsayılan
  kapalı" DEĞİL, çünkü caching güvenlik değil performans özelliği).
  `/api/pivot`+`/api/query` 60sn TTL ile cache'lendi (anahtar
  session.id'yi de içeriyor — kullanıcı bazlı veri erişimi nedeniyle),
  `upsertFacts`/`revertUpload`'da modelId bazlı anlık invalidation.
  `next dev`'e karşı manuel doğrulama: ilk sorgu 352ms, cache'li ikinci
  sorgu 24ms, sonuçlar aynı. 12 yeni test — toplam **240 test**.
  Lint/typecheck/build temiz. **Henüz commit edilmedi** — kullanıcı
  onayı bekleniyor, sonra Sprint 3.2 madde 3 (real-time collaboration)
  için onay istenecek.
- Redis caching commit edildi ve push edildi (`a5d9ff4`, origin/main
  güncel).
- Sprint 3.2 madde 3 (real-time collaboration) bu oturumda implemente
  edildi — kullanıcı "çok karmaşıksa alt maddelere böl" dediği için
  mimari karar + schema + API + hook + 2 sayfa client entegrasyonu
  olarak alt-adımlara bölündü. **Mimari karar: WebSocket DEĞİL**
  — proje `next start` ile dağıtılan standart bir App Router uygulaması,
  kalıcı WebSocket sunucusu dağıtım modelini kökten değiştirirdi; kod
  tabanında zaten WebSocket/SSE altyapısı yoktu (incelenip doğrulandı),
  tek "canlı güncelleme" idiomu NotificationBell.tsx'teki setInterval
  polling'di. Bunun yerine: `reports`/`dashboards`'a `version` kolonu +
  `lib/version-guard.ts` (`versionedUpdate` — 409 Conflict ile
  lost-update önleme) + `lib/hooks/useVersionConflict.ts` (409→conflict
  banner + 20sn polling→"başkası güncelledi" banner) + her iki sayfaya
  entegrasyon. `next dev`'e karşı manuel doğrulama: doğru versiyonla PUT
  200, eski versiyonla ikinci PUT 409 (current.version doğru). 5 yeni
  test — toplam **245 test**. Lint (React Compiler ref kuralı ihlali
  tekrar bulunup düzeltildi)/typecheck/build temiz. **Henüz commit
  edilmedi** — kullanıcı onayı bekleniyor.
- Sprint 3.2'nin TÜMÜ (virtualized grid + Redis caching + real-time
  collaboration) artık tamamlandı. Sıradaki: Sprint 3.3 madde 1 (BI
  export API) için onay istenecek.
- Real-time collaboration commit edildi ve push edildi (`c39527a`,
  origin/main güncel).
- Sprint 3.3 madde 1 (BI export API) bu oturumda implemente edildi.
  **Mimari karar: pragmatik OData alt kümesi, tam OData v4 protokolü
  DEĞİL** (EDMX XML/$expand/batch yok) — Power BI/Tableau'nun REST/Web
  bağlayıcıları düz JSON ile de çalışır. `api_keys` tablosu + `lib/
  api-keys.ts` (ham anahtar sadece oluşturma anında bir kez döner, sha256
  hash saklanır) + `lib/api-auth.ts` (Bearer token doğrulama) + `/api/v1/
  odata/{route,metadata,[modelCode]}` + `lib/odata.ts` ($top/$skip/
  $filter parse). `proxy.ts` `PUBLIC_PATHS`'e `/api/v1` eklendi (kendi
  auth mekanizması var). Self-service anahtar yönetimi `/api/api-keys` +
  `account/security` sayfasına UI. `next dev`'e karşı uçtan uca manuel
  doğrulama: anahtar oluştur → servis belgesi → metadata → veri (sayfalı)
  → auth'suz 401 → iptal → iptal sonrası 401, hepsi beklendiği gibi.
  21 yeni test — toplam **266 test**. Lint/typecheck/build temiz.
  **Henüz commit edilmedi** — kullanıcı onayı bekleniyor, sonra Sprint
  3.3 madde 2 (mobil/PWA) için onay istenecek.

---

## 2026-06-10 (önceki alt-bölüm) — Faz 2 / Sprint 2.3 BAŞLADI (madde-madde çalışılıyor)

### Önceki kayıtlar (değişmedi)
- Faz 1 (Sprint 1.1 `ec421f3` + Sprint 1.2 `bfb05ed`)
- Faz 2 / Sprint 2.1 (Workflow + senaryo, `3a6e4f2`)
- Faz 2 / Sprint 2.2 (Audit trail + formül motoru + iş kuralları, `e3da2a5`)

### Sprint 2.3 kapsamı (5 madde, kullanıcı talebiyle tek tek işleniyor, her maddeden sonra onay isteniyor)

1. **Connector plugin mimarisi — TAMAMLANDI (bu oturumda commit edilecek)**
   - `connector_configs` tablosu, `ConnectorTypeDef` fabrika pattern'i
     (`lib/connectors/types.ts`), `sap-mock.ts`/`sap-odata.ts` ikisi de hem
     `ConnectorTypeDef` hem geriye-uyumlu statik `Connector` export ediyor.
   - `lib/connector-configs.ts`: CRUD + `seedConnectorConfigsFromEnv()`
     (modül yüklenince bir kez çalışır, eski `.env.local` tabanlı SAP OData
     kurulumunu otomatik DB config'ine taşır).
   - `lib/connectors/index.ts`: `CONNECTOR_TYPES` + `listConnectorInstances()`/
     `getConnectorInstance(id)` — artık statik dizi yerine DB'den dinamik üretim.
   - `/api/connector-configs` (+`[id]`, `/types`), mevcut `/api/integrations*`
     route'ları `connector: string` → `connector: number` (config id) olacak
     şekilde güncellendi.
   - UI: `integrations/page.tsx`'e admin-only "Bağlantıları Yönet" paneli
     (CRUD + test et, türe göre dinamik form alanları).
   - 12 yeni test (`connector-configs.test.ts`) → **toplam 112 test**.
   - **Önemli lint notu:** React Compiler'ın `preserve-manual-memoization`
     kuralı, bir `useCallback`'in bağımlılık dizisini (`[]`) kapanışta
     kullanılan state (`connectorId`) ile tutarsız bulunca hata veriyor.
     Çözüm: state'i `useRef` ile takip etmeye çalışmak işe yaramadı (farklı
     bir inferred-dependency hatası çıktı); doğru çözüm `useMemo`'yu tamamen
     kaldırıp düz `const connector = connectors.find(...)` satırına dönmek
     oldu (gereksiz memoization kaldırılınca derleyici kuralı tetiklenmedi).
   - Lint/typecheck/test/build hepsi yeşil, gerçek `next dev` sunucusuna karşı
     manuel doğrulama yapıldı.

2. **a11y iyileştirmeleri** (MemberPicker/DrillModal focus-trap, ESC, ARIA) — henüz başlanmadı.
3. **i18n'i export dosyalarına (PPTX/Excel) ve kalan hata mesajlarına yayma** — henüz başlanmadı.
4. **Bildirim sistemi (in-app)** — henüz başlanmadı.
5. **Zamanlanmış SAP senkronizasyonu (cron/webhook)** — henüz başlanmadı.

**Çalışma şekli (kullanıcı talebi):** Her madde tek başına tamamlanıp
doğrulanacak (lint/typecheck/test/build), sonra kullanıcıya "sıradaki maddeye
geçeyim mi" diye `ask_user` ile sorulacak. Onay gelmeden sıradaki maddeye
geçilmeyecek. Commit/push kararı da kullanıcı onayına bağlı (bu oturumda ilk
maddeden sonra "önce commit+push yap" seçildi — yani her madde sonunda değil,
kullanıcı istediğinde commit atılıyor).

## Sıradaki adım (güncel — Sprint 2.3 tamamlandı, Faz 3 devam ediyor)

Sprint 2.3'ün 5 maddesi de tamamlandı. Devamında Faz 3 (Sprint 3.1/3.2/3.3)
üzerinde, aynı "madde tek tek + kullanıcı onayı + her maddeden sonra ayrı
commit+push" çalışma şekliyle ilerlendi. Detaylı teknik gerekçeler artık
`docs/ROADMAP.md`'deki ilgili madde notlarında tutuluyor (bu dosyadaki eski
ayrıntı yerine orası güncel kaynak).

Tamamlanan Faz 3 maddeleri (hepsi ayrı commit):
1. Sprint 3.1 madde 1 — 2FA/TOTP
2. Sprint 3.1 madde 2 — SSO/OIDC
3. Sprint 3.1 madde 3 — Çoklu-tenant/organizasyon desteği
4. Sprint 3.2 madde 1 — Virtualized pivot grid
5. Sprint 3.2 madde 2 — Redis caching
6. Sprint 3.2 madde 3 — Real-time collaboration / optimistic concurrency
7. Sprint 3.3 madde 1 — BI export API / REST-OData
8. Sprint 3.3 madde 2 — Mobil/responsive dashboard + PWA desteği

- Sprint 3.3 madde 2 commit+push edildi (8f2c927). Madde 3 (anomali tespiti /
  AI destekli forecast) için plan sunuldu, kullanıcı kapsamın henüz netleşmediğini
  belirtti → **madde Faz 3'ten çıkarılıp `docs/ROADMAP.md`'deki "Gelecek Yol
  Haritası (Backlog)" bölümüne taşındı**, bir sprint'e bağlanmadı. Bu haliyle
  **Faz 3 tamamlandı sayılıyor** (anomali/forecast hariç, bilerek bekletiliyor).
- Kullanıcıya "bunun dışında ne kaldı" sorusu için Must-Have tablosu güncellendi:
  madde 4 (optimistic concurrency) tamamlandı olarak işaretlendi (zaten Sprint
  3.2'de yapılmıştı, tabloda unutulmuştu); madde 7 (CI/CD) kontrol edilip
  tamamlandı işaretlendi (`.github/workflows/ci.yml` zaten vardı); madde 8
  (backup) "kısmen tamamlandı" (`scripts/backup-db.js` var, otomatik
  zamanlama/off-site kopya yok); madde 12 (rate limit + zod tutarlılığı)
  "kısmen" olarak güncellendi (rate limit sadece 5 kritik endpoint'te,
  zod 61 route'un 32'sinde). Kalan gerçek açık maddeler: madde 5 (satır-seviyesi
  güvenlik için ayrı admin UI yok, hâlâ Users sayfasına gömülü) ve madde 12'nin
  tam kapsaması.

- **Madde 12 (rate limit + input sanitization tutarlılığı) tamamlandı
  (2026-06-10):** `proxy.ts`'e tüm `/api/*` için IP bazlı taban rate limit
  eklendi (özel 5 kural dışındaki ~56 route artık korumasız değil). Yeni
  `lib/route-params.ts` (`parseIdParam`/`invalidIdResponse`) ile 19 `[id]`
  route dosyası toplu güncellendi — artık geçersiz id (örn. harf) 500 yerine
  temiz `400 invalid_id` döner (önceden better-sqlite3 NaN bind hatasıyla
  yakalanmamış 500 veriyordu). `/api/notifications` POST zod'a geçirildi,
  `listNotifications` limit parametresi NaN'a karşı korundu. 11 yeni test
  (`route-params.test.ts`, `rate-limit.test.ts`) — toplam **286 test**.
  Lint/typecheck/build temiz. Must-Have tablosu madde 12 "Tamamlandı"
  işaretlendi. Commit+push edildi (909dd8c).

- **Madde 5 (satır-seviyesi güvenlik admin UI) tamamlandı (2026-06-10):**
  Yeni `/admin/access` denetim matrisi sayfası — kullanıcı × boyut, her
  hücre "Tüm"/"N üye" rozeti, tıklanınca düzenleme paneli açılır. Yeni
  `GET /api/access` (bulk, admin-only) + `lib/access.ts` → `getTenantAccessEntries`.
  Satır-içi düzenleme paneli `components/DataAccessEditor.tsx`'e çıkarılıp
  hem eski `/admin/users` hem yeni sayfa aynı bileşeni kullanıyor. Nav + i18n
  (`access.*`) eklendi. 2 yeni test — toplam **288 test**. Gerçek `next dev`
  sunucusuna karşı login→PUT→GET→sayfa render tam döngüsü manuel doğrulandı.
  Lint/typecheck/build temiz. Must-Have tablosu madde 5 "Tamamlandı"
  işaretlendi. Commit+push edildi (6381029).

- **Kalıcı tercih güncellemesi (2026-06-10):** kullanıcı artık git için onay
  istenmesine gerek olmadığını belirtti — bundan sonra her madde
  tamamlandığında (test/lint/typecheck/build yeşil) otomatik commit+push
  yapılıyor, ayrıca sorulmuyor (bkz. dosyanın başındaki "Kalıcı kullanıcı
  tercihi" notu).

- **Nice-to-Have: Klavye kısayolları tamamlandı (2026-06-10):** Yeni
  `lib/shortcuts.ts` (`matchesHotkey` + `useHotkey`), `Ctrl/Cmd+K` komut
  paleti (`CommandPalette.tsx`), `?` yardım penceresi
  (`ShortcutsHelpModal.tsx`), `Ctrl/Cmd+S` kaydet + `Ctrl/Cmd+Enter` çalıştır
  (reports/dashboards sayfalarındaki mevcut fonksiyonlara bağlandı, GitHub
  tarzı "g sonra r" dizileri kasıtlı olarak eklenmedi). 6 yeni test — toplam
  **294 test**. Lint/typecheck/build temiz. Commit+push edildi (8f777e1).

- **Nice-to-Have: Hücre düzeyinde undo/redo (Ctrl+Z) tamamlandı (2026-06-10):**
  Projede hiç inline fact düzenleme UI'ı yoktu — `/browser` sayfasına "Değer"
  hücresine tıkla-düzenle eklendi (yeni `PATCH /api/facts/[id]`, mevcut
  `upsertFacts`'i tek satırla çağırarak lock/business-rule/fact_audit
  altyapısını yeniden kullanıyor). `rollbackFactAudit` artık ürettiği YENİ
  `fact_audit` kaydını döndürüyor (void→FactAuditEntry) — bu, "redo = undo'nun
  rollback'i" zincirlemesini mümkün kılıyor, ekstra tablo/state gerekmedi.
  Ctrl/Cmd+Z (undo) + Ctrl/Cmd+Shift+Z veya Ctrl+Y (redo), sayfa-oturumuna
  özel undo/redo yığını (model/filtre değişince sıfırlanır). `shortcuts.ts`'e
  `shift` alanı eklendi (Ctrl+Z/Ctrl+Shift+Z ayrımı için). İki yeni React
  Compiler kuralıyla karşılaşıldı ve çözüldü ("ref render sırasında
  okunamaz" → useState'e geçildi; "memoization korunamadı" → useCallback
  kaldırıldı). 6 yeni test — toplam **300 test**. Gerçek `next dev`
  sunucusuna karşı tam PATCH→undo→redo→cleanup döngüsü doğrulandı.
  Lint/typecheck/build temiz. **Henüz commit edilmedi, sıradaki adım
  commit+push.**

## 2026-07-10 — Çoklu-model join sorusu + boyut sınırı 8→16

- Kullanıcı "birden fazla modeli joinleyip raporlamak mümkün mü" diye sordu —
  hayır: `reports.modelId` tekil, `query.ts` tek model `facts` sorguluyor,
  `dimension_members`'ta attribute/özellik alanı yok. Kullanıcı talebiyle
  `docs/ROADMAP.md` backlog'a bağımlılık sırasıyla iki madde eklendi: (1)
  boyut üyesi özellikleri (`dimension_member_attributes` taslağı), (2) ona
  BAĞIMLI çoklu-model join (ortak boyut veya attribute üzerinden, SQL JOIN
  değil uygulama-katmanı eşleştirme). Commit+push: `94149db`.
- Kullanıcı "model başına max boyut sayısı var mı" diye sordu — evet: `facts`/
  `fact_audit` EAV değil, sabit `d1..d8` kolonlu (`lib/db/schema.ts`), zod
  `.max(8)` (`api/models/route.ts`) bunu erken reddediyordu.
- Kullanıcı 3 talep/soru iletti: (1) "sınırsız boyut" backlog'a eklensin,
  (2) sınırı şimdilik 8→16 çıkar, (3) tek `value` kolonunu da artırmak/
  sınırsız yapmak mümkün mü (soru, kod değişikliği istenmedi).
  - **(2) uygulandı:** `lib/model.ts`'e `MAX_MODEL_DIMENSIONS = 16` sabiti
    eklendi (tek kaynak), `api/models/route.ts` zod `.max(8)` →
    `.max(MAX_MODEL_DIMENSIONS)`. `lib/db/schema.ts` (`facts`/`factAudit`
    drizzle tanımları) ve `lib/db/index.ts` (DDL `CREATE TABLE` + mevcut
    veritabanları için `ALTER TABLE ... ADD COLUMN d9..d16` migrasyonu, hem
    `facts` hem `fact_audit` için) güncellendi. Gerçek dev `data/planrep.db`
    dosyasında migrasyonun uygulandığı `PRAGMA table_info` ile doğrulandı.
    `lib/tenant.ts` yorumundaki "d1..d8" referansı "d1..d16" yapıldı.
  - **Ortam notu (önemli, gelecek oturumlar için):** proje klasörü yolunda
    `&` karakteri var (`NTT PLA&REP`) — `npm run <script>` Windows'ta cmd.exe
    shim'i (.cmd dosyası) bu karakteri yanlış işliyor ("not recognized as
    internal or external command" hatası). Çözüm: npm script'leri DEĞİL,
    doğrudan `node node_modules/<pkg>/bin/...` çağır (örn.
    `node node_modules/typescript/bin/tsc --noEmit`,
    `node node_modules/vitest/vitest.mjs run`,
    `node node_modules/eslint/bin/eslint.js`,
    `node node_modules/next/dist/bin/next build`). Doğrulama: typecheck
    temiz, **300/300 test** geçti, lint 0 hata (1 önceden var olan ilişkisiz
    uyarı), `next build` başarılı (tüm route'lar derlendi).
  - **(1) ve (3) backlog'a eklendi** (henüz kod değişikliği yok, kapsam
    netleşmedi): "Sınırsız boyut sayısı (EAV'a geçiş)" ve "Sınırsız/çoklu
    değer (measure) kolonu" — ikisi de aynı köke sahip (sabit kolon →
    EAV dönüşümü) ama ayrı maddeler olarak eklendi, measure maddesi boyut
    maddesiyle birlikte ele alınması gerektiği notuyla.
  - **Henüz commit edilmedi** — sıradaki adım commit+push.
