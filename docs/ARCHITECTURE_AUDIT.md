# PlanRep — Mimari Analiz & Teknik Borç Raporu

> **Durum:** Yaşayan doküman. Takip için `ROADMAP.md` dosyasına bakın (checkbox'lı iş listesi).
> **Son güncelleme:** 2026-05-10
> **Kapsam:** 77 dosya, Next.js 16 (App Router) + better-sqlite3/Drizzle + JWT auth.

PlanRep, Excel/SAP-OData kaynaklı, dimension/hierarchy tabanlı bir **OLAP-benzeri planlama & raporlama** uygulamasıdır (Anaplan / SAP BPC / Jedox'un küçük ölçekli bir muadili).

---

## 1. Mimari Özet

| Katman | Teknoloji | Not |
|---|---|---|
| UI | Next.js App Router, React 19, Tailwind | Sayfa başına çok fazla `useState`, context/reducer yok |
| API | Next.js route handlers (31 adet) | Zod ile kısmi doğrulama, tutarsız yetkilendirme |
| Veri | **better-sqlite3** (senkron, dosya tabanlı) + Drizzle (sadece şema) | Tek dosya DB, WAL mode |
| Hesap motoru | `lib/pivot.ts`, `lib/query.ts`, `lib/formula.ts` | İstemci + sunucu ayrık, memoize edilmiş özyinelemeli roll-up |
| Auth | JWT (jose) + bcrypt, cookie session | RBAC üç rol: admin/planner/viewer |
| Entegrasyon | SAP OData connector + mock, Excel import/export, PPTX export | Statik connector registry (plugin yok) |
| AI | Harici `axet-code.exe` CLI + kural tabanlı Türkçe fallback | Platform bağımlı (Windows path hardcoded) |
| Versiyon kontrolü | **Yok** (proje klasörü git repo değil) | — |
| Test/CI | **Yok** (test script, CI pipeline, Docker yok) | — |

**Güçlü yönler:**
- Dimension/hierarchy modeli ve pivot roll-up algoritması (`lib/pivot.ts`, `lib/query.ts`) sağlam tasarlanmış.
- Formül motoru (DSL: `[KOLON]+ - * /`) güvenli (whitelist token parser, eval yok).
- Satır bazlı veri erişim kontrolü (`lib/access.ts`) hem okuma hem SAP/Excel import yazmasında **tutarlı** uygulanmış.
- Upload revert/snapshot mekanizması (`lib/facts-write.ts`) — geri alınabilir importlar.
- Audit log (`lib/audit.ts`) kritik işlemlerin çoğunda çağrılıyor.

---

## 2. Darboğazlar ve Teknik Borç

### 2.1 Altyapı / Ölçeklenebilirlik (Kritik)
- **better-sqlite3 tamamen senkron** → her sorgu Node event-loop'u bloklar; çok kullanıcılı/eşzamanlı yükte tüm istekler kilitlenir.
- **Tek dosya SQLite** → yatay ölçekleme, replikasyon, HA yok; yedekleme/backup stratejisi kodda yok.
- `facts` tablosu **d1..d8 sabit kolon** modeli (EAV benzeri) — 8 boyut hard-limit; 9. boyut gerekirse şema migration gerekir.
- `upsertFacts` (`lib/facts-write.ts:10-48`) satır-satır SELECT+DELETE+INSERT (N+1) — büyük Excel/SAP importlarında performans sorunu.
- `getModelDims` (`lib/model.ts:35-48`), `/api/dimensions`, `/api/models` → 2N+1 sorgu paterni.
- `/api/pivot`, `/api/query`, `/api/facts` → **pagination/row-cap yok** (facts hariç, o paginated); büyük hiyerarşilerde tüm tuple seti tarayıcıya gönderiliyor.
- SQL `IN (...)` listeleri chunk'lanmıyor → SQLite'ın 999 parametre limitine çarpabilir.

### 2.2 Güvenlik
- `lib/session.ts:5-7` — `JWT_SECRET` için hardcoded fallback (`"dev-secret-change-me"`); env unutulursa session'lar sahtelenebilir.
- Session cookie'de `secure:true` flag yok.
- **CSRF koruması yok** (SameSite=lax'a tam güven).
- **Rate limiting hiçbir uçta yok** — login brute-force, AI query (90s subprocess) DoS riski.
- `api/comments/route.ts` → **entity-level yetkilendirme eksik**: herhangi bir kullanıcı erişimi olmayan rapor/dashboard'a ID tahmin ederek yorum okuyup yazabiliyor.
- `api/export/excel`, `api/export/pptx` → istemciden gelen `ExportPayload` **yeniden yetkilendirilmiyor**, Zod şema doğrulaması yok (crash/DoS riski).
- `api/users/[id]/route.ts` — "son admin" kontrolü **TOCTOU race condition**; eşzamanlı iki istek sıfır admin bırakabilir.
- `lib/connectors/sap-odata.ts` + `api/integrations/import` — ondalık/binlik ayracı hatası: `"1,234.56"` formatı `parseFloat` ile sessizce `1.234`'e dönüşebilir → **finansal veride sessiz veri bozulması**.
- `lib/connectors/sap-mock.ts` — `Math.random()` ile non-deterministic veri; demo/test tekrarlanabilirliği yok.
- `lib/ai/nl2report.ts` — kullanıcı sorusu LLM prompt'una escape edilmeden ekleniyor (prompt-injection yüzeyi; `toDef()` whitelist doğrulaması riski büyük ölçüde azaltıyor).

### 2.3 Veri Bütünlüğü
- **Hiyerarşi döngü koruması yok**: `api/members/[id]/route.ts` PATCH'inde bir üye kendi alt-torununun altına taşınırsa özyinelemeli roll-up fonksiyonlarında (`withDescendants`, `cellsOf`) sonsuz döngü/stack overflow riski.
- Model silindiğinde (`api/models/[id]/route.ts`): `comments` ve özel (private) dimension'ların `owner_model_id` alanı **temizlenmiyor** → yetim veri.
- Rapor/Dashboard'da **optimistic concurrency yok** — eşzamanlı düzenlemelerde son yazan kazanır.
- Excel/SAP import **all-or-nothing** (`api/upload/route.ts`, `api/integrations/import/route.ts`) — tek hatalı satır tüm importu reddediyor.

### 2.4 Test / DevOps (Kritik — Eksik)
- **Hiç test yok** (unit/integration/e2e).
- **CI/CD pipeline yok**, **Docker/konteyner yapılandırması yok**, **Git repo yok** (en acil düzeltme).
- Lint var (`eslint`) ama tip kontrolü/format otomasyonu (pre-commit hook) yok.

### 2.5 Frontend / UX
- Context/Redux/Zustand yok; sayfa başı 15-25 `useState` → prop drilling, kod tekrarı (`reports/page.tsx` 1158 satır).
- Hiçbir yerde **error boundary** yok; hata yönetimi inline string mesajlarıyla sınırlı.
- Loading state'ler genelde düz "Yükleniyor..." metni; skeleton/spinner tutarsız.
- `PivotGrid.tsx`, `MemberPicker.tsx` — **virtualization yok**, büyük veri setlerinde DOM performansı düşer.
- Erişilebilirlik (a11y) hemen hemen yok: modal'larda focus-trap/ESC yok (`DrillModal.tsx`), drag-and-drop'un klavye eşdeğeri yok, ARIA attribute'ları eksik (`MemberPicker.tsx` combobox pattern yok).
- i18n yarım: `getT()` kullanılıyor ama export (PPTX/Excel) ve çoğu hata mesajı **hardcoded Türkçe**.
- `confirm()`/`alert()` native dialog'ları kritik aksiyonlarda kullanılıyor.

### 2.6 AI / Entegrasyon Modülü
- `api/ai/query/route.ts` — yerel `axet-code.exe` binary'sine (Windows path hardcoded) bağımlı; konteyner/bulut dağıtımında kırılır.
- `lib/ai/nl2report.ts:12` — prompt'a dimension üyeleri **40 ile sınırlı** gönderiliyor; büyük hiyerarşilerde LLM hatalı/eksik eşleme yapabilir.
- `lib/connectors/sap-odata.ts` — sadece **Basic Auth** destekliyor (OAuth2/sertifika yok).
- `lib/connectors/index.ts` — connector registry **statik dizi**; plugin mimarisi yok.

---

## 3. Detaylı Dosya/Modül Notları (referans)

Aşağıdaki modüller derinlemesine incelendi; satır numaraları ve bulgular için bu bölüme bakılabilir (kısaltılmış özet — tam analiz sohbet geçmişinde mevcuttur):

- `lib/model.ts`, `lib/query.ts`, `lib/pivot.ts`, `lib/formula.ts`, `lib/access.ts`, `lib/auth.ts`, `lib/session.ts`, `lib/audit.ts`, `lib/facts-write.ts`, `lib/db/index.ts`, `middleware.ts`, `lib/report-types.ts`
- `lib/connectors/{index,sap-mock,sap-odata,types}.ts`
- `lib/ai/nl2report.ts`, `lib/i18n.ts`
- 31 API route dosyası (`src/app/api/**/route.ts`)
- 15 frontend sayfa/komponent dosyası (`src/app/(app)/**/page.tsx`, `src/components/*.tsx`)

---

## 4. Karşılaştırma: Rakip Araçlar (Anaplan, SAP BPC/Analytics Cloud, Oracle EPM, Power BI, Tableau)

PlanRep'in temel OLAP/pivot/formül altyapısı sağlam, ancak kurumsal planlama araçlarında standart olan şu özellikler **eksik**: workflow/onay akışı, senaryo yönetimi, cell-level undo/versiyon karşılaştırma, zamanlanmış veri senkronizasyonu, iş kuralı (business rule) motoru, bildirim sistemi.

Detaylı liste → `ROADMAP.md`.

---

## 5. Sonuç

Mimari temel sağlam (dimension-hiyerarşi modeli, pivot/formül motoru, erişim kontrolü iyi tasarlanmış), ancak **ölçeklenebilirlik (senkron SQLite), güvenlik sertleştirme, test/CI altyapısı ve kurumsal planlama iş akışları (approval/workflow, senaryo yönetimi)** eksik — bunlar "demo/POC" seviyesinden "kurumsal production" seviyesine çıkmak için öncelikli boşluklar.

---

## 6. Veritabanı Geçiş Değerlendirmesi (PostgreSQL vs. better-sqlite3) — 2026-06-10

**Soru:** PostgreSQL'e geçiş mi (Drizzle ORM soyutlaması zaten mevcut), yoksa better-sqlite3 için async wrapper/connection pool mu?

**Mevcut durumun analizi:**
- `better-sqlite3` **tamamen senkron** çalışıyor; her sorgu Node event-loop'unu bloklar. Tek kullanıcı/düşük eşzamanlılıkta (şu anki demo/pilot ölçeği) bu sorun yaratmıyor çünkü sorgular milisaniyeler sürüyor, ama çok kullanıcılı production yükünde (örn. 50+ eşzamanlı planlayıcı aynı anda büyük pivot sorgusu çalıştırırsa) event-loop kilitlenmesi tüm isteklerin kuyruğa girmesine yol açar.
- `facts` tablosu `d1..d8` sabit kolon (EAV-benzeri) modeli kullanıyor; bu şema **PostgreSQL'e sorunsuz taşınabilir** (aynı DDL, SQLite'a özgü hiçbir sözdizimi yok — `AUTOINCREMENT`→`SERIAL`/`IDENTITY`, `TEXT`/`REAL` tipleri birebir karşılığı var).
- Drizzle ORM şu an sadece **şema tanımı** için kullanılıyor (`lib/db/schema.ts`); gerçek sorgular ham `sqlite.prepare()` ile yazılmış. Drizzle'ın `drizzle-orm/node-postgres` veya `drizzle-orm/postgres-js` adaptörüne geçiş şema katmanında kolay, ama **tüm `sqlite.prepare(...).all/get/run()` çağrıları** (yaklaşık 30+ dosyada) senkron SQLite API'sine bağımlı; PostgreSQL sürücüleri (örn. `pg`, `postgres`) **asenkron**'dur, yani her çağrı `await` gerektirir — bu, `getModelDims`, `runQuery`, `upsertFacts` gibi senkron imzalı tüm fonksiyonların ve bunları çağıran ~25 API route'unun imzasının `async`'e çevrilmesini gerektiren **geniş kapsamlı bir refactor**.
- `better-sqlite3`'ün resmi async/connection-pool sarmalayıcısı yok (kütüphane kasıtlı olarak senkron); "async wrapper" demek pratikte `worker_threads` havuzuna sorgu dağıtmak anlamına gelir — bu, WAL modunda tek dosyaya çoklu thread'den yazma karmaşıklığı (lock çakışmaları) getirir ve PostgreSQL'in native sağladığı eşzamanlılık/transaction garantilerini elle yeniden inşa etmek anlamına gelir.

**Karar / öneri:** **Şimdilik better-sqlite3'te kal, PostgreSQL geçişini Faz 2/3'e (gerçek çoklu-kullanıcı production yüküne geçerken) planla.**

Gerekçe:
1. Mevcut ölçek (pilot/demo, muhtemelen <20 eşzamanlı kullanıcı) için senkron SQLite'ın pratikte bir performans sorunu **gözlenmedi**; erken optimizasyon riski (büyük refactor + regresyon riski) kazanılacak faydadan daha yüksek.
2. Bu sprint içinde zaten uygulanan **N+1 düzeltmeleri** (`getModelDims`/`getModels`/`/api/dimensions`) ve **toplu (bulk) upsert** (`upsertFacts`) iyileştirmeleri, senkron SQLite'ın pratik darboğazlarının büyük kısmını (sorgu sayısı, round-trip) zaten azaltıyor — PostgreSQL'in asıl getirisi (gerçek eşzamanlı yazma, event-loop'u bloklamama) sadece **gerçek çoklu-kullanıcı production yükünde** ölçülebilir hale gelecek.
3. Drizzle ORM'in şema soyutlaması zaten var olduğundan, geçiş kararı ileri bir tarihe bırakılsa da **maliyeti artmıyor** — şema tanımı aynı kalır, sadece adaptör (`better-sqlite3` → `postgres-js`) ve çağrı siteleri (`sqlite.prepare` → Drizzle query builder, senkron → async) değişecek.
4. **Tetikleyici kriter (ne zaman geçilmeli):** Production'da (a) eşzamanlı kullanıcı sayısı ~50'yi aştığında, (b) `facts` tablosu satır sayısı tek SQLite dosyası için pratik sınırı (onlarca milyon satır) zorladığında, veya (c) yatay ölçekleme/okuma replikası gereksinimi doğduğunda, PostgreSQL geçişi öncelikli hale gelmeli.

**Geçiş yapılacaksa izlenecek yol (ileride referans için):**
1. Drizzle adaptörünü `drizzle-orm/postgres-js` (veya `node-postgres`) ile değiştir, şema dosyasını (`sqlite-core` → `pg-core`) güncelle.
2. Tüm `sqlite.prepare(...).all/get/run()` çağrılarını Drizzle query builder'a veya `await pool.query(...)`'a taşı; bu, `lib/model.ts`, `lib/query.ts`, `lib/access.ts`, `lib/facts-write.ts` ve ~25 API route'unun **tamamen async zincire** çevrilmesini gerektirir.
3. `better-sqlite3`'e özgü `sqlite.transaction(() => {...})()` senkron transaction pattern'i yerine PostgreSQL'in `BEGIN/COMMIT` + `await` tabanlı transaction API'sine geçilmeli.
4. docker-compose.yml'e bir `postgres` servisi eklenmeli; `DATABASE_PATH` env değişkeni `DATABASE_URL`'e dönüşmeli.
5. Mevcut SQLite verisini taşımak için tek seferlik bir migration scripti (satır satır `SELECT * FROM <tablo>` → `INSERT INTO` PostgreSQL) yazılmalı.

