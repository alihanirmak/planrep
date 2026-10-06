# Oturum İlerleme Notları (yaşayan dosya — her oturumda güncellenir)

> Amaç: "kalınan yer" her zaman burada net olsun. Yeni bir oturuma başlarken önce bu dosyayı oku.

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

## Sıradaki adım

- Madde 1 (connector plugin) için commit + push yapılacak, sonra madde 2
  (a11y) için onay istenecek.
