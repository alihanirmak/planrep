# PlanRep — Geliştirme Yol Haritası & Takip Listesi

> **Nasıl kullanılır:** Bu dosya yaşayan bir takip listesidir. Bir madde üzerinde çalışmaya başlarken `[ ]` → işe başlandığında yorum/PR linki ekleyin, tamamlandığında `[x]` yapın. Detaylı mimari gerekçeler için `ARCHITECTURE_AUDIT.md`'ye bakın.
> **Son güncelleme:** 2026-05-10

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

## Faz 1 — Kısa Vade (≈1 ay)

- [ ] Veritabanı geçiş değerlendirmesi: PostgreSQL'e geçiş planı (Drizzle ORM soyutlaması zaten mevcut) veya better-sqlite3 için async wrapper/connection pool
- [ ] `upsertFacts` (`lib/facts-write.ts`) satır-satır işlemi toplu (bulk) upsert'e çevir
- [ ] `/api/pivot`, `/api/query` endpoint'lerine satır/sütun üst sınırı + sayfalama ekle
- [ ] Model/rapor/dashboard silme işlemlerine cascade cleanup ekle (comments, dimension `owner_model_id` reset)
- [ ] Test altyapısı kurulumu (Vitest/Jest) ve kritik modüller için birim testleri:
  - [ ] `lib/formula.ts`
  - [ ] `lib/pivot.ts`
  - [ ] `lib/access.ts`
  - [ ] `lib/facts-write.ts`
  - [ ] `lib/query.ts`
- [ ] Dockerfile + docker-compose.yml oluştur
- [ ] Temel DB yedekleme scripti (SQLite dosya snapshot + rotasyon)
- [ ] SQL `IN (...)` listelerini chunk'lama (999 parametre limiti için)
- [ ] `getModelDims`/`/api/dimensions`/`/api/models` N+1 sorgu paternlerini optimize et (JOIN ile tekilleştir)
- [ ] React Compiler lint borcu temizliği (`eslint-plugin-react-hooks` v7: set-state-in-effect, static-components, immutability) — `admin/users/page.tsx`, `reports/page.tsx`, `DashboardWidget.tsx`, `ReportView.tsx`, `Sidebar.tsx`

## Faz 2 — Orta Vade (2-3 ay)

- [ ] Workflow/onay akışı (submit → review → approve → lock) veri modeli + UI
- [ ] Senaryo/versiyon karşılaştırma ekranı (VERSION dimension üzerine kopyalama/compare UI)
- [ ] Cell-level audit trail görünümü + rollback (undo) mekanizması
- [ ] Formül motoruna gelişmiş fonksiyonlar: `IF`, `SUMIF`, zaman-serisi ofseti (`[ACCOUNT].PY`, `MOVAVG`)
- [ ] İş kuralı (business rule) motoru — örn. "Bütçe negatif olamaz" tipi validasyonlar
- [ ] Connector plugin mimarisi (DB'de connector config, dinamik kayıt — statik dizi yerine)
- [ ] Erişilebilirlik (a11y) iyileştirmeleri: ARIA attribute'ları, modal focus-trap/ESC, klavye navigasyonu (`MemberPicker`, `DrillModal`, drag-and-drop alanları)
- [ ] i18n'i tam kapsama al (export dosyaları — PPTX/Excel başlık/etiketler, tüm hata mesajları)
- [ ] Bildirim sistemi (yorum/mention, onay bekleyen görev — en azından in-app, sonra e-posta)
- [ ] Zamanlanmış veri yenileme (cron/webhook ile SAP OData senkronizasyonu)

## Faz 3 — Uzun Vade (3-6 ay)

- [ ] Çoklu-tenant / organizasyon desteği
- [ ] SSO entegrasyonu (SAML/OAuth2/Okta/Azure AD)
- [ ] Gerçek zamanlı collaboration (WebSocket, eşzamanlı düzenleme kilidi/optimistic concurrency)
- [ ] Anomali tespiti / AI destekli öngörü (forecast) modülü
- [ ] Mobil/responsive dashboard, PWA desteği
- [ ] Harici BI araçlarına veri köprüsü (REST/OData export API — Power BI/Tableau bağlantısı)
- [ ] 2FA desteği
- [ ] Büyük pivot tabloları için sanal kaydırma (virtualized grid — `PivotGrid.tsx`)
- [ ] Sunucu taraflı caching (Redis) katmanı

---

## Must-Have Özellik Listesi (Kurumsal Planlama Araçlarıyla Kıyaslama)

> Anaplan / SAP BPC / SAP Analytics Cloud / Oracle EPM gibi araçlarda standart olup PlanRep'te eksik olan özellikler.

| # | Özellik | Gerekçe | Benzer araç örneği | Faz |
|---|---|---|---|---|
| 1 | Workflow / Onay akışı (submit→review→approve→lock) | Planlama araçlarının çekirdeği; şu an herkes direkt veri yazıyor | Anaplan, SAP BPC "data lock" | Faz 2 |
| 2 | Versiyon/senaryo yönetimi (what-if) | VERSION dim var ama senaryo kopyalama/karşılaştırma UI'ı yok | SAP Analytics Cloud, Anaplan | Faz 2 |
| 3 | Audit trail + cell-level undo/redo | Audit log var ama görünüm/rollback yok | Anaplan "Version compare" | Faz 2 |
| 4 | Eşzamanlılık kilidi / optimistic concurrency | Row-locking yok | Excel Online, Google Sheets | Faz 3 |
| 5 | Satır-seviyesi güvenlik UI'ı iyileştirmesi | Granülerlik ve denetim arayüzü eksik | SAP BPC "Data Access Profiles" | Faz 2 |
| 6 | Zamanlanmış/otomatik SAP senkronizasyonu | Şu an manuel preview/import | Power BI "scheduled refresh" | Faz 2 |
| 7 | Test altyapısı + CI/CD + versiyon kontrolü | Üretim güvenilirliği için olmazsa olmaz | — | Faz 0/1 |
| 8 | Yedekleme/Disaster Recovery stratejisi | Tek SQLite dosyası, yedekleme yok | — | Faz 1 |
| 9 | Bildirim sistemi (yorum/mention, onay bekleyen görev) | Yorum var, bildirim/mail yok | Tüm BI araçları | Faz 2 |
| 10 | Gelişmiş formül fonksiyonları (IF, SUMIF, zaman-ofseti) | Şu an sadece `+ - * /` | Excel, Anaplan formula engine | Faz 2 |
| 11 | Veri doğrulama / business rules | Örn. "Bütçe negatif olamaz" — yok | Tüm EPM araçları | Faz 2 |
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
