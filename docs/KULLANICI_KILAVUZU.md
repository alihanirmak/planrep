# PlanRep — Kullanıcı Kılavuzu

> Bu kılavuz, PlanRep'i son kullanıcı olarak (planlamacı, izleyici veya yönetici) nasıl kullanacağınızı adım adım anlatır. Teknik/geliştirme detayları için `docs/ROADMAP.md` ve `docs/GELISTIRME_OZETI.md`'ye bakabilirsiniz.

---

## İçindekiler

1. [Giriş ve Hesap](#1-giriş-ve-hesap)
2. [Genel Gezinme](#2-genel-gezinme)
3. [Modelleme — Model ve Boyut Tanımlama](#3-modelleme--model-ve-boyut-tanımlama)
4. [Veri Yükleme (Excel)](#4-veri-yükleme-excel)
5. [Veri Gözatma ve Düzenleme](#5-veri-gözatma-ve-düzenleme)
6. [Raporlar](#6-raporlar)
7. [Dashboardlar](#7-dashboardlar)
8. [Onay Akışı (Workflow)](#8-onay-akışı-workflow)
9. [Senaryolar (Bütçe/Gerçekleşen/Tahmin)](#9-senaryolar-bütçegerçekleşentahmin)
10. [AI ile Doğal Dil Sorgulama](#10-ai-ile-doğal-dil-sorgulama)
11. [Entegrasyonlar (Connector)](#11-entegrasyonlar-connector)
12. [Bildirimler](#12-bildirimler)
13. [Hesap Güvenliği](#13-hesap-güvenliği)
14. [Yönetici (Admin) Ekranları](#14-yönetici-admin-ekranları)
15. [Klavye Kısayolları](#15-klavye-kısayolları)
16. [Mobil Kullanım ve Uygulama Gibi Yükleme (PWA)](#16-mobil-kullanım-ve-uygulama-gibi-yükleme-pwa)
17. [Sık Sorulan Sorular](#17-sık-sorulan-sorular)

---

## 1. Giriş ve Hesap

### 1.1 Giriş yapma

Giriş ekranında e-posta ve şifrenizi girin.

- Hesabınızda **iki adımlı doğrulama (2FA)** açıksa, şifre sonrası authenticator uygulamanızdaki (Google Authenticator, Authy vb.) 6 haneli kodu girmeniz istenir. Bu ekranın 5 dakikalık bir süre sınırı vardır; süre dolarsa baştan giriş yapmanız gerekir.
- Organizasyonunuz **SSO (Okta/Azure AD vb.)** kullanıyorsa, giriş ekranında "... ile giriş yap" butonu görünür — e-posta/şifre girmeden bu butonla giriş yapabilirsiniz.

### 1.2 Yeni organizasyon oluşturma (Signup)

`/signup` sayfası **mevcut bir organizasyona kullanıcı eklemek için DEĞİL**, sıfırdan **yeni bir organizasyon (tenant)** kurmak içindir. Organizasyon adı, benzersiz bir organizasyon kodu (örn. `acme-corp`), yöneticinin adı/e-postası/şifresini girip gönderdiğinizde organizasyonunuz ve ilk yönetici hesabınız otomatik oluşturulur, doğrudan giriş yapılır.

> Mevcut bir organizasyona kullanıcı eklemek isterseniz, o organizasyonun yöneticisinden `/admin/users` sayfasında sizin için hesap açmasını istemelisiniz.

### 1.3 Dil değiştirme

Sol menünün alt kısmında **TR / EN** butonları ile arayüz dilini anında değiştirebilirsiniz.

---

## 2. Genel Gezinme

Sol menüde (mobilde ☰ hamburger menü ile açılır) tüm ana bölümlere erişirsiniz. Menüde:

- Rolünüze göre bazı bağlantılar (Kullanıcılar, Veri Yetkileri, Denetim Kaydı) **sadece yöneticilere** görünür.
- Üstte/altta bildirim zili (🔔) ve kullanıcı bilgisi + çıkış butonu bulunur.
- **Hızlı gezinme**: `Ctrl/Cmd + K` tuş kombinasyonuyla açılan arama paneliyle istediğiniz sayfaya anında gidebilirsiniz (bkz. [Klavye Kısayolları](#15-klavye-kısayolları)).

---

## 3. Modelleme — Model ve Boyut Tanımlama

`/modeling` sayfasından:

- **Model**: Raporlanacak veri alanı (örn. "Satış Bütçesi"). Her model birkaç **boyut** (dimension) içerir.
- **Boyut**: Hesap, maliyet merkezi, zaman, versiyon gibi veri kırılımları. Her boyutun hiyerarşik **üyeleri** (members) vardır — örn. "2026" üyesinin altında "2026-01", "2026-02" gibi alt üyeler olabilir.
- Yeni model/boyut oluşturmak ve üyeleri yönetmek (ekle/sil/sırala/üst-öğe değiştir) buradan yapılır.

> Model/boyut oluşturma ve düzenleme **admin ve planner** rolüne açıktır; viewer rolü sadece görüntüler.

---

## 4. Veri Yükleme (Excel)

`/upload` sayfasından:

1. Model seçin.
2. **"📥 Örnek şablonu indir"** ile o modele özel bir Excel şablonu indirin — bu şablonda:
   - **"Veri"** sayfası: her boyutun kod sütunu + bir **DEGER** (değer) sütunu, bir örnek satır.
   - **"Üyeler"** sayfası: o modeldeki tüm geçerli üye kod/ad eşleşmelerinin referans listesi.
3. Şablonu doldurup (veya kendi dosyanızı hazırlayıp) yükleyin.

**Önemli kurallar:**
- Değer sütunu başlığı `DEGER`, `DEĞER`, `VALUE` veya `TUTAR` olabilir.
- Boyut sütun başlıkları, o boyutun **kodu veya adı** olabilir (büyük/küçük harf duyarsız).
- Hücrelerde üye **kodu veya adı** kullanılabilir.
- **Aynı koordinatta (örn. aynı ay + aynı hesap + aynı maliyet merkezi) daha önce veri varsa, yeni değer ESKİSİNİN ÜZERİNE YAZILIR** (toplanmaz).
- Yükleme sonrası "Yükleme Geçmişi" listesinden, o yüklemeyi **geri alabilirsiniz** (eski değerler otomatik geri yüklenir).
- Erişim kısıtınız varsa (bkz. [Veri Yetkileri](#14-yönetici-admin-ekranları)), yetkiniz dışındaki üyelere ait satırlar reddedilir.

---

## 5. Veri Gözatma ve Düzenleme

`/browser` sayfasından, modeldeki ham verileri filtreleyip inceleyebilirsiniz.

### 5.1 Hücre düzenleme

**planner** ve **admin** rolleri, "Değer" sütunundaki bir hücreye **tıklayarak** doğrudan düzenleyebilir:

1. Hücreye tıklayın → düzenleme kutusu açılır.
2. Yeni değeri yazın (TR/EN ondalık formatı — `1.234,56` veya `1234.56` — otomatik tanınır).
3. **Enter** ile kaydedin, **Esc** ile iptal edin (veya kutudan dışarı tıklayıp otomatik kaydedin).

### 5.2 Geri al / Yinele

Bir hücreyi düzenledikten sonra:

- **Ctrl/Cmd + Z** → son değişikliği geri alır.
- **Ctrl/Cmd + Shift + Z** (veya **Ctrl + Y**) → geri alınan değişikliği yeniden uygular (redo).

> Bu geri al/yinele geçmişi **sadece o anki tarayıcı oturumunuza ve seçili filtre/modele** özeldir — sayfayı yenilediğinizde veya model/filtre değiştirdiğinizde sıfırlanır. Kalıcı değişiklik geçmişi için admin'lerin kullandığı [Denetim Kaydı](#14-yönetici-admin-ekranları) ekranına bakın.

### 5.3 Kesit bazlı silme

En az bir filtre seçtiğinizde (tüm veriyi filtre olmadan silmek engellenmiştir) **"🗑 Filtrelenen veriyi sil"** butonuyla o kesitteki tüm kayıtları kalıcı olarak silebilirsiniz (planner/admin).

---

## 6. Raporlar

`/reports` sayfası, PlanRep'in pivot tablo raporlama motorudur.

### 6.1 Rapor tasarımı

1. Bir **Model** seçin.
2. Sağdaki boyut listesinden, boyut etiketlerini sürükleyip **Satırlar**, **Sütunlar** veya **Kullanılmayan** bölgelerine bırakın (klavye ile de ok tuşlarıyla taşınabilir — erişilebilirlik için).
   - Satırlara en fazla 3, sütunlara en fazla 2 boyut eklenebilir.
3. Üstteki filtre çubuğundan her boyut için görmek istediğiniz üyeleri seçin.
4. **▶ Çalıştır** (veya **Ctrl/Cmd + Enter**) ile raporu çalıştırın.

### 6.2 Hesaplanan sütun/satır (calc columns/rows)

Mevcut sütun/satırlardan türetilmiş yeni bir sütun/satır eklemek için bir ad ve formül yazın. Formülde köşeli parantez `[...]` içinde sütun/satır anahtarı (kod) kullanılır:

| Örnek | Açıklama |
|---|---|
| `[BUDGET]-[ACTUAL]` | Bütçe eksi Gerçekleşen farkı |
| `[TOTAL]` veya `[TOPLAM]` | Genel toplam referansı |
| `IF([A]>0;"Pozitif";"Negatif")` | Koşullu metin/değer |
| `SUM([A];[B];[C])`, `AVG(...)`, `MIN(...)`, `MAX(...)` | Toplama fonksiyonları |
| `SUMIF([VERSION]="BUDGET";[A];[VERSION]="ACTUAL";[B])` | Koşullu toplama |
| `[2026-03.PY]` | Aynı dönemin **önceki yıl** değeri |
| `[2026-03.MOVAVG(3)]` | 3 dönemlik **hareketli ortalama** |

> **Önemli:** Fonksiyon argümanları `;` (noktalı virgül) ile ayrılır — TR ondalık ayracı olan virgülle (`1,5`) karışmasın diye (Excel'in TR sürümüyle aynı kural).

### 6.3 Dışa aktarma ve paylaşım

- **Dışa aktarma formatları:** Excel (📗), PowerPoint/PPTX (📙), CSV, Yazdır (🖨).
- **Paylaşım:** Her rapor 🔗 ile **Paylaşılan** (organizasyonunuzdaki herkes görebilir) veya **Özel** (sadece siz) yapılabilir. Paylaşılan bir raporu başkaları açıp görebilir ama sadece sahibi düzenleyip silebilir.
- **Yorum ekleme (@bahsetme):** Rapor üzerinde 💬 ikonuna tıklayıp yorum yazabilirsiniz. Bir kullanıcıyı bilgilendirmek için `@kullaniciadi` yazın (ad veya e-postanın kullanıcı adı kısmı) — o kişiye bildirim gider. Rapor sahibi her yeni yorumdan otomatik bilgilendirilir.

---

## 7. Dashboardlar

`/dashboards` sayfasından kendi izleme ekranınızı kurabilirsiniz.

### 7.1 Widget ekleme

**"+ Widget Ekle"** butonuna basın →

1. Veri kaynağını seçin: elle bir model/boyut/filtre tanımlayın VEYA kayıtlı bir raporu kaynak gösterin.
2. Widget tipini seçin:
   - 🔢 **KPI Kartı** — tek bir sayı/metrik.
   - 📊 **Çubuk Grafik**
   - 📈 **Çizgi Grafik**
   - 🍩 **Pasta/Halka Grafik**
   - ▦ **Mini Tablo**
   - 📋 **Tam Rapor** — bir raporun pivot görünümünü gömer.
3. Başlık yazıp ekleyin.

Widget'lar sürüklenerek yeniden sıralanabilir, tam genişliğe büyütülebilir veya kaldırılabilir. Dashboard'un üstündeki **genel filtre çubuğu**, seçtiğiniz değerleri TÜM widget'lara aynı anda uygular.

### 7.2 Kaydetme ve paylaşım

Dashboard da raporlar gibi **Paylaşılan/Özel** olabilir, `Ctrl/Cmd+S` ile kaydedebilirsiniz.

---

## 8. Onay Akışı (Workflow)

`/workflow` sayfası, bir veri kesitinin (örn. "Ocak 2026 Satış Bütçesi") onay sürecini yönetir.

**Durum akışı:** Taslak (draft) → Gönderildi (submitted) → İnceleniyor (in_review) → **Onaylandı** veya **Reddedildi** → (onaylanırsa) **Kilitli** (locked).

- Bir workflow **sahibi (owner)**, kapsamı (model + boyut filtreleri) tanımlayıp veriyi hazırlar, hazır olduğunda **gönderir**.
- **Onaylayan (approver)** inceleyip onaylar veya reddeder.
- Onaylanıp **kilitlenen** bir kesitteki veriler, kilit kaldırılana kadar **hiçbir şekilde değiştirilemez** (upload, hücre düzenleme, senaryo kopyalama dahil tüm yazma işlemleri reddedilir).
- **viewer** rolü hiçbir durum geçişi yapamaz, sadece izleyebilir.
- Her geçiş `/workflow/[id]` detay sayfasındaki **geçmiş** bölümünde kayıtlıdır.

---

## 9. Senaryolar (Bütçe/Gerçekleşen/Tahmin)

`/scenarios` sayfası, bir **VERSION** boyutundaki (örn. BÜTÇE / GERÇEKLEŞEN / TAHMİN) iki üye arasında karşılaştırma ve kopyalama yapmanızı sağlar.

### 9.1 Karşılaştırma

Model + satır boyutu seçtiğinizde, VERSION üyeleri sütun olarak yan yana görünür; fark ve yüzde değişim otomatik hesaplanır.

### 9.2 Senaryo kopyalama

1. **Kaynak (From)** versiyon üyesini ve **Hedef (To)** versiyon üyesini seçin (örn. Bütçe → Tahmin).
2. İsteğe bağlı filtrelerle kapsamı sınırlayın.
3. **Kopyala**'ya basın — onay istenir, çünkü **hedefteki mevcut değerler üzerine yazılır**.

> Hedef kesit bir workflow tarafından kilitliyse, kopyalama işlemi reddedilir.

---

## 10. AI ile Doğal Dil Sorgulama

`/ai` sayfasına Türkçe bir soru yazarak hızlıca bir rapor oluşturabilirsiniz — örn: *"2026 yılında maliyet merkezi bazında en yüksek 5 gider hesabı"*.

- Sistem önce kurumsal AI altyapısıyla (axet-code) sorunuzu bir rapor tanımına çevirmeye çalışır.
- Bu altyapı erişilemezse, basit **kural tabanlı** bir çözümleyici devreye girer (anahtar kelimelerle boyut/versiyon/top-N eşleştirmesi).
- Sonuç bulunduğunda **"📊 Raporda Aç"** ile doğrudan Raporlar ekranına geçip düzenleyebilirsiniz.

---

## 11. Entegrasyonlar (Connector)

`/integrations` sayfasından harici sistemlerden (örn. SAP OData) veri çekebilirsiniz.

1. **Admin**, önce "Bağlantıları Yönet" panelinden bir **connector** (bağlantı) tanımlar — tür (SAP OData, test/mock kaynağı vb.), adres ve kimlik bilgileri.
2. Kullanıcı bu bağlantıyı seçip veriyi **önizler**, sütunları model boyutlarıyla **eşler**, ardından **içe aktarır**.
3. Admin isterse bu içe aktarmayı **zamanlanmış senkronizasyon** olarak otomatikleştirebilir (periyodik tekrar).
4. Her içe aktarma da normal bir yükleme gibi geri alınabilir ve denetim kaydına işlenir.

---

## 12. Bildirimler

Sağ üstteki/sol alttaki 🔔 zil ikonu, aşağıdaki durumlarda sizi bilgilendirir:

| Bildirim | Ne zaman gelir |
|---|---|
| Yeni yorum | Bir raporda/dashboard'da izlediğiniz bir kayda yorum yapıldığında |
| Bahsedilme (@mention) | Bir yorumda sizi `@kullaniciadi` ile etiketlediklerinde |
| İnceleme bekliyor | Onaylamanız gereken bir workflow geldiğinde |
| Onaylandı | Gönderdiğiniz bir workflow onaylandığında |
| Reddedildi | Gönderdiğiniz bir workflow reddedildiğinde |

Bildirime tıklayarak ilgili kayda doğrudan gidebilir, zildeki listeden "tümünü okundu işaretle" yapabilirsiniz.

---

## 13. Hesap Güvenliği

`/account/security` sayfasında:

### 13.1 İki Adımlı Doğrulama (2FA)

- **Açma:** Ekrandaki QR kodu/gizli anahtarı authenticator uygulamanıza (Google Authenticator vb.) ekleyin, uygulamanın ürettiği 6 haneli kodu girip onaylayın. Size tek kullanımlık **yedek kurtarma kodları** gösterilir — bunları güvenli bir yerde saklayın (authenticator cihazınızı kaybederseniz girişte kullanılır).
- **Kapatma:** Şifrenizi girerek 2FA'yı devre dışı bırakabilirsiniz.

> Hesabınız **SSO** ile giriş yapıyorsa, bu bölüm yerine "bu hesap [sağlayıcı] ile giriş yapıyor" bilgisi gösterilir — şifre/2FA yönetimi o sağlayıcı üzerinden yapılır.

### 13.2 API Anahtarları

Power BI, Tableau gibi harici araçların PlanRep verinize REST/OData üzerinden erişmesi için kullanılır.

1. **"+ Yeni Anahtar"** ile adlandırılmış bir anahtar oluşturun.
2. Anahtar değeri **SADECE oluşturma anında bir kez** gösterilir — hemen kopyalayıp güvenli saklayın, daha sonra tekrar görüntülenemez.
3. Listeden anahtarın son kullanım zamanını takip edebilir, gerekirse **"İptal Et"** ile anahtarı devre dışı bırakabilirsiniz.

---

## 14. Yönetici (Admin) Ekranları

Aşağıdaki sayfalar sadece **admin** rolüne görünür:

### 14.1 Kullanıcılar (`/admin/users`)
Yeni kullanıcı oluşturma, rol değiştirme (admin/planner/viewer), kullanıcı silme.

### 14.2 Veri Yetkileri (`/admin/access`)
Hangi kullanıcının hangi boyutta **kısıtlı** erişime sahip olduğunu gösteren **kullanıcı × boyut matrisi**:

- Her hücre "Tüm" (kısıtsız) veya "N üye" (kısıtlı) rozetiyle gösterilir.
- Herhangi bir hücreye tıklayarak o kullanıcının TÜM boyutlardaki erişimini tek panelden düzenleyebilirsiniz.
- Üstteki arama kutusu ve "sadece kısıtlı kullanıcılar" filtresiyle büyük kullanıcı listelerinde hızlı denetim yapabilirsiniz.
- **Kural:** Bir boyutta hiç kısıtlama tanımlı değilse, kullanıcı o boyutta **tam erişime** sahiptir. Kısıtlama tanımlandığında, kullanıcı seçilen üyeleri (ve onların alt üyelerini) görür/yazabilir, diğerlerini göremez.

### 14.3 Denetim Kaydı (`/admin/audit`, `/admin/audit/cells`)
- **Genel denetim kaydı:** Kullanıcıların yaptığı tüm önemli işlemlerin (giriş, silme, onay, API anahtarı vb.) listesi.
- **Hücre denetimi:** Her fact (veri) değişikliğinin eski/yeni değeri, kim tarafından ve ne zaman yapıldığı; buradan herhangi bir değişiklik **geri alınabilir** (rolünüz viewer değilse).

### 14.4 Model/Boyut Yönetimi, İş Kuralları, Connector Ayarları
Bu işlemler sırasıyla `/modeling`, model detay sayfası ve `/integrations` içinde admin'e özel panellerle yapılır (iş kuralları: belirli bir değerin eşik aşması durumunda uyarı/blok; connector: bağlantı kimlik bilgileri).

---

## 15. Klavye Kısayolları

| Kısayol | İşlev |
|---|---|
| `Ctrl/Cmd + K` | Hızlı sayfa geçişi (komut paleti) açar |
| `?` | Bu kısayol listesini açar |
| `Ctrl/Cmd + S` | Geçerli rapor/dashboard'u kaydeder |
| `Ctrl/Cmd + Enter` | Raporu çalıştırır |
| `Ctrl/Cmd + Z` | (Veri Gözatma'da) son hücre düzenlemesini geri alır |
| `Ctrl/Cmd + Shift + Z` veya `Ctrl + Y` | Geri alınan düzenlemeyi yeniden uygular |
| `Esc` | Açık pencere/paneli kapatır |

> `?` gibi mod'suz (Ctrl/Cmd içermeyen) kısayollar, bir metin kutusuna yazı yazarken **tetiklenmez** — arama kutusuna soru işareti yazarken yardım penceresinin açılmasını önlemek için.

---

## 16. Mobil Kullanım ve Uygulama Gibi Yükleme (PWA)

- **Mobil tarayıcı:** Ekran dar olduğunda sol menü otomatik olarak gizlenir; üstteki ☰ (hamburger) ikonuna dokunarak açabilirsiniz.
- **Ana ekrana ekleme (PWA):** Telefonunuzun tarayıcı menüsünden "Ana ekrana ekle" seçeneğiyle PlanRep'i bir uygulama simgesi gibi telefonunuza ekleyebilirsiniz. Bu, sadece görsel/erişim kolaylığı sağlar — **çevrimdışı veri girişi desteklenmez** (uygulama her zaman internet bağlantısı gerektirir, bilerek böyle tasarlanmıştır: bayat veya yetkisiz veri gösterme riskini önlemek için).

---

## 17. Sık Sorulan Sorular

**S: Bir hücreyi yanlış değerle güncelledim, geri alabilir miyim?**
C: Evet. Hemen sonra `/browser` ekranındaysanız `Ctrl/Cmd+Z` ile geri alabilirsiniz. Daha sonra fark ederseniz, bir admin'den `/admin/audit/cells` ekranından o değişikliği geri almasını isteyebilirsiniz.

**S: Raporumu bir meslektaşımla paylaşmak istiyorum, nasıl yaparım?**
C: Rapor ekranında 🔗 "Paylaş" butonunu açın — rapor artık organizasyonunuzdaki herkese görünür olur. Düzenleme hakkı yine sadece sizde kalır.

**S: Şifremi/2FA'mı değiştiremiyorum, neden?**
C: Hesabınız SSO (Okta/Azure AD vb.) ile giriş yapıyorsa, bu ayarlar sizin organizasyonunuzun kimlik sağlayıcısı üzerinden yönetilir, PlanRep üzerinden değiştirilemez.

**S: Veri yüklerken "yetkiniz yok" hatası alıyorum.**
C: Yöneticiniz, veri yetkileri ekranından sizi belirli boyut üyeleriyle sınırlamış olabilir. Hangi üyelerle çalışabileceğinizi öğrenmek için yöneticinizle iletişime geçin.

**S: Workflow'um kilitli bir veriye yazmaya çalışınca hata veriyor.**
C: O veri kesiti onaylanıp kilitlenmiş. Değişiklik yapmanız gerekiyorsa, ilgili workflow'un kilidinin kaldırılması (admin/approver tarafından) gerekir.

**S: Mobilde uygulamayı internetsiz kullanabilir miyim?**
C: Hayır, kasıtlı olarak desteklenmiyor — veri her zaman güncel ve yetki kontrolünden geçmiş olmalı.
