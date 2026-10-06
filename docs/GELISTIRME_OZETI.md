# PlanRep — Geliştirme Özeti

> Bu doküman, projenin kurumsal planlama/raporlama aracı olarak hangi aşamalardan geçtiğini, hangi özelliklerin eklendiğini ve genel mimari kararları **özet** halinde anlatır. Detaylı teknik gerekçeler ve madde-madde tamamlama notları için `docs/ROADMAP.md`'ye, oturum bazlı ilerleme kayıtları için `docs/SESSION_NOTES.md`'ye bakın. Son kullanıcı için adım adım kullanım anlatımı `docs/KULLANICI_KILAVUZU.md`'dedir.

**Güncelleme tarihi:** 2026-06-10

---

## 1. PlanRep nedir?

PlanRep, Anaplan / SAP BPC / SAP Analytics Cloud benzeri bir **kurumsal planlama ve raporlama (EPM)** aracıdır. Çok boyutlu veri modelleri (model + boyutlar: hesap, maliyet merkezi, zaman, versiyon vb.) üzerinde pivot raporlama, dashboard, bütçe/gerçekleşen senaryo yönetimi, onay akışları ve harici sistem entegrasyonu sunar.

## 2. Geliştirme fazları — ne yapıldı?

Proje dört fazda, her faz kendi içinde sprintlere bölünerek ilerledi. Aşağıdaki özet, her fazda **neyin çözüldüğünü** anlatır (nasıl çözüldüğünün teknik detayı `ROADMAP.md`'de).

### Faz 0 — Acil güvenlik/sağlamlık borçları
Projeyi production'a çıkarmadan önce kapatılması gereken temel açıklar: zorunlu `JWT_SECRET`, güvenli session cookie, export uçlarına girdi doğrulama, yorum (comment) erişim kontrolü, sayı ayrıştırma (locale) hatası, hiyerarşi döngü koruması, temel rate limiting, "son admin'i düşürme" yarış durumu düzeltmesi.

### Faz 1 — Kısa vade altyapı temizliği
- **Sprint 1.1:** Lint borcu temizliği, silme işlemlerinde cascade cleanup, SQL `IN(...)` chunk'lama, N+1 sorgu optimizasyonu, Docker + docker-compose, DB yedekleme scripti.
- **Sprint 1.2:** PostgreSQL geçiş değerlendirmesi (karar: şimdilik SQLite'ta kal), toplu (bulk) upsert, sorgu sonucu üst sınırı, **Vitest test altyapısının kurulması** (bu noktadan sonra her özellik testle doğrulandı).

### Faz 2 — Orta vade: planlama süreçleri
- **Sprint 2.1:** Workflow/onay akışı (taslak→gönder→incele→onayla→kilitle) + veri kilidi, senaryo (bütçe/gerçekleşen/tahmin) kopyalama ve karşılaştırma ekranı.
- **Sprint 2.2:** Hücre bazlı audit trail + geri alma (rollback), gelişmiş formül motoru (IF/SUM/AVG/MIN/MAX + zaman ofseti — önceki yıl, hareketli ortalama), iş kuralı (business rule) motoru (veri doğrulama, blok/uyarı seviyeleri).
- **Sprint 2.3:** Dinamik connector (bağlayıcı) mimarisi, erişilebilirlik (a11y) iyileştirmeleri, çok dilli (TR/EN) arayüz, bildirim sistemi, zamanlanmış SAP senkronizasyonu.

### Faz 3 — Uzun vade: kurumsal özellikler
- **Sprint 3.1 — Güvenlik & çoklu organizasyon:** İki adımlı doğrulama (2FA/TOTP), SSO (OIDC — Okta/Azure AD uyumlu), çoklu-tenant (her organizasyon kendi verisini görür, self-service kayıt).
- **Sprint 3.2 — Performans & gerçek zamanlılık:** Büyük tablolar için sanal kaydırma (virtualized grid), Redis destekli (opsiyonel) sunucu-taraflı caching, optimistic concurrency ile eşzamanlı düzenleme çakışma yönetimi.
- **Sprint 3.3 — Dış dünya & mobil:** Harici BI araçlarına (Power BI/Tableau) REST/OData veri köprüsü + API anahtarı yönetimi, mobil/responsive tasarım + PWA (uygulama gibi yüklenebilme) desteği.

### Faz 3 sonrası — ek iyileştirmeler (bu oturumda, Must-Have ve Nice-to-Have listesinden)
- **Satır-seviyesi güvenlik denetim ekranı** (`/admin/access`) — hangi kullanıcının hangi veri boyutunda kısıtlı erişimi olduğunu tek ekrandan görüp düzenleme.
- **API güvenlik tutarlılığı** — tüm API uçlarına taban rate limiting + tüm `[id]` tabanlı uçlarda tutarlı girdi doğrulama.
- **Klavye kısayolları** — hızlı sayfa geçişi (Ctrl/Cmd+K komut paleti), kaydet (Ctrl/Cmd+S), raporu çalıştır (Ctrl/Cmd+Enter), yardım penceresi (`?`).
- **Hücre düzeyinde geri al/yinele (Ctrl+Z / Ctrl+Shift+Z)** — veri gözatma ekranında hücre değerini doğrudan düzenleme + klavye kısayoluyla geri alma/yineleme.

## 3. Rakamlarla özet

| Ölçüt | Değer |
|---|---|
| Toplam otomatik test | **300** (hepsi geçiyor) |
| Lint/typecheck/build durumu | Temiz (0 hata) |
| Tamamlanan Must-Have (kurumsal karşılaştırma) madde sayısı | 12 / 12 |
| Tamamlanan Nice-to-Have madde sayısı | Çoğu tamamlandı, kalanlar bilinçli olarak backlog'a taşındı (bkz. madde 5) |

## 4. Mimari felsefe (tekrarlanan kararlar)

Proje boyunca tutarlı şekilde izlenen bazı prensipler:

- **Bağımlılık yüzeyini büyütme:** Mümkün olduğunda harici kütüphane eklemek yerine basit, test edilebilir kendi implementasyonları yazıldı (TOTP, PKCE, sanal kaydırma, service worker, klavye kısayolu altyapısı). İstisna: Redis gibi protokolü sıfırdan yazmanın anlamsız olduğu durumlarda (ioredis) kütüphane eklendi — ama her zaman bağımlılıksız bir fallback ile.
- **Güvenlik > kozmetik kolaylık:** Örn. PWA service worker sadece statik varlıkları cache'ler, API/HTML'i cache'lemez (bayat/yetkisiz veri riski); kullanıcı yakınlaştırmasını kısıtlayan viewport ayarları eklenmedi (a11y/WCAG).
- **"Doğrudan + transitive" çoklu-tenant izolasyonu:** Üst seviye kaynaklara (`users`, `models`, `dimensions` vb.) `tenant_id` eklendi; alt/çocuk tablolara (facts, comments vb.) eklenmedi — izolasyon her zaman ebeveyn kaynağın tenant kontrolünden geçerek sağlanıyor.
- **Var olan altyapının yeniden kullanımı:** Hücre düzeyinde undo/redo, yeni bir tablo eklemeden mevcut `fact_audit` zincirleme mekanizmasının üzerine inşa edildi. Satır-seviyesi güvenlik denetim ekranı, mevcut per-user erişim API'sini genişleterek (yeni bir yazma ucu eklemeden) yapıldı.
- **Her madde ayrı doğrulama + commit:** Her özellik kendi testleriyle doğrulandı (lint/typecheck/test/build), gerçek `next dev` sunucusuna karşı manuel smoke test yapıldı, ayrı bir commit olarak işlendi.

## 5. Bilinçli olarak kapsam dışı bırakılanlar (backlog)

Aşağıdaki maddeler kullanıcı talebiyle **"Gelecek Yol Haritası (Backlog)"** bölümüne taşındı — kapsamları henüz netleşmediği için bir sprint'e bağlanmadı:

- Anomali tespiti / AI destekli öngörü (forecast) modülü
- Dashboard: sürükle-bırak grid layout, gerçek zamanlı widget yenileme
- Collaboration: canlı imleç (Figma-style), değişiklik geçmişi diff görünümü
- AI: doğal dil ile veri yazma, çoklu dil NLP
- Performans: PostgreSQL + read-replica geçişi
- UX: Dark mode
- Güvenlik: IP allowlist, refresh token yönetimi
- DevOps: otomatik DB migration genişletmesi (Drizzle Kit)

Detaylar için `docs/ROADMAP.md` → "Gelecek Yol Haritası (Backlog)" bölümüne bakın.
