# Codex Project Guide

Bu dosya Hitmaker projesinde çalışan Codex/agent oturumları için kalıcı proje kuralıdır. Kullanıcı tekrar söylemese bile her yeni kod bu kurallara göre yazılmalıdır.

`CODEX.md` ve `CLAUDE.md` bu dosyaya yönlenir. Kuralların ana kaynağı `AGENTS.md` dosyasıdır; mimari kural değişirse önce burası güncellenmelidir.

## Temel Kural

Her kod değişikliği MVC katmanlarına ve SOLID prensiplerine uygun olmalıdır. Hızlı çözüm için controller'a iş kuralı, repository'ye orchestration, model'e workflow veya automation dosyasına queue/database sorumluluğu eklenmez.

## Proje Özeti

Hitmaker, Node.js tabanlı browser task runner'dır.

- Express web route'ları EJS view render eder; API route'ları task/log isteklerini karşılar.
- BullMQ + Redis task'ları worker'a taşır.
- Worker task run'larını MongoDB üzerinde takip eder.
- Browser otomasyonu Playwright API'si üzerinden CloakBrowser ile çalışır.
- UI HTML'i `views/` altında EJS olarak render edilir; `public/` sadece JS/CSS asset tutar.

## Katmanlar

- `config/`: Environment değişkenlerini normalize eden config modülleri. Uygulama config'i `config/app.js` içinde kalır.
- `bootstrap/`: Runtime bağlantılarını başlatan dosyalar. Database ve queue instance'ları burada oluşturulur.
- `app/Models/`: Mongoose schema ve model tanımları. Sadece veri şekli, doğrulama ve model seviyesindeki basit kısıtlar burada olmalıdır.
- `app/Repositories/`: MongoDB/Mongoose erişimi. Query, create, update ve persistence detayları burada kalır.
- `app/Domain/`: Saf iş kuralları ve hesaplamalar. Database, queue, HTTP veya browser dependency'si almamalıdır.
- `app/Validators/`: HTTP payload normalize ve validate eder. Request body'sini uygulama içi DTO'ya çevirir.
- `app/Services/`: Use-case ve orchestration katmanı. Controller'dan gelen işi repository, domain, queue ve automation adapter'larına dağıtır.
- `app/Http/Controllers/`: HTTP request/response sınırı. Sadece service çağırır, status code döner, JSON body üretir veya view render eder.
- `app/Http/Middleware/`: Express middleware katmanı. Cross-cutting HTTP davranışları burada kalır.
- `views/`: EJS template katmanı. HTML burada tutulur; iş kuralı, database erişimi veya queue/browser logic içermez. View'lar layout, partial, page ve component olarak bölünmelidir.
- `routes/`: Express route tanımları. Sadece endpoint ile controller method eşleştirir.
- `app/Automation/`: Browser otomasyon adapter ve akışları. Database, queue veya HTTP response bilmemelidir.
- `app/Utils/`: Framework bağımsız küçük yardımcı fonksiyonlar.

## Mevcut Akış

1. `routes/webRoutes.js`, `/` sayfasını `app/Http/Controllers/homeController.js` içine yönlendirir.
2. `app/Http/Controllers/homeController.js`, `views/layouts/main.ejs` layout'u ile `views/home/index.ejs` view'ını render eder.
3. `routes/taskRoutes.js` task endpoint'lerini `app/Http/Controllers/taskController.js` içine yönlendirir.
4. `app/Http/Controllers/taskController.js`, `app/Services/taskService.js` çağırır.
5. `app/Services/taskService.js`, payload'ı validator ile normalize eder, task'ı repository ile kaydeder ve `app/Services/taskJobService.js` üzerinden BullMQ kuyruğuna gönderir.
6. `worker.js`, BullMQ job'unu `app/Services/taskProcessorService.js` ile işler.
7. `app/Services/taskProcessorService.js`, run planını `app/Domain/taskRunPlanner.js` ile üretir ve concurrency ile `app/Services/taskRunService.js` çağırır.
8. `app/Services/taskRunService.js`, run durumunu repository ile günceller ve `app/Automation/googleClick.js` üzerinden browser akışını çalıştırır.
9. `app/Automation/cloakBrowserClient.js`, CloakBrowser + Playwright context oluşturmanın tek sahibidir.

## SOLID Kuralları

- Single Responsibility: Her dosyanın tek değişme sebebi olmalıdır. Bir dosya hem HTTP hem DB hem browser yönetmemelidir.
- Open/Closed: Yeni browser sağlayıcısı, queue sağlayıcısı veya task tipi eklenirken mevcut use-case'ler mümkün olduğunca adapter/service eklenerek genişletilmelidir.
- Liskov Substitution: Inject edilen dependency'ler aynı davranış sözleşmesini korumalıdır.
- Interface Segregation: Service'lere ihtiyaç duymadıkları geniş dependency objeleri verilmemelidir.
- Dependency Inversion: Üst seviye orchestration kodu somut implementation detayına doğrudan gömülmemelidir; queue, repository ve browser çağrıları ayrı sınırlarda tutulmalıdır.

## Kod Yazma Kuralları

- Controller içinde validation, database query, queue publish veya browser logic yazma.
- Repository içinde business status hesabı, job progress hesabı veya browser logic yazma.
- Domain fonksiyonları saf kalmalı; side effect içermemeli.
- Service dosyaları küçük use-case'lere bölünmeli. Bir service büyüyorsa yeni service veya domain modülü çıkar.
- Click scheduling kararı `app/Domain/taskRunPlanner.js` içinde kalmalı; gerçek bekleme/sleep davranışı `app/Services/runScheduleService.js` içinde kalmalı.
- Browser launch ayarları sadece `app/Automation/cloakBrowserClient.js` içinde değiştirilmeli.
- Google sonuç sayfası arama/sayfalama davranışı `app/Automation/googleSearchResults.js` içinde kalmalı.
- Cookie dönüşümü sadece `app/Automation/browserCookies.js` içinde kalmalı.
- Queue publish sadece `app/Services/taskJobService.js` sınırında kalmalı.
- Worker orchestration sadece `app/Services/taskProcessorService.js` içinde kalmalı.
- Yeni route eklenirse kaynak bazlı route dosyası aç veya mevcut kaynak route'una ekle; `routes/index.js` sadece router mount etsin.
- Task lifecycle, worker lifecycle, browser navigation, Google sayfalama, proxy kullanımı, click sonucu, hata ve cancellation dahil tüm önemli aksiyonlar `app/Services/logService.js` logger'ı ile loglanmalı.
- HTML sayfası gerekiyorsa `public/*.html` yazma; `views/` altında EJS view oluştur ve controller üzerinden render et.
- View tek büyük dosya olmamalı. Shell için `views/layouts/`, tekrar eden parçalar için `views/partials/`, sayfa içeriği için kaynak bazlı klasörler ve küçük UI parçaları için `components/` kullan.
- Async controller hataları `app/Http/Middleware/asyncHandler.js` ile yakalanmalı.
- Yeni env değişkeni eklenirse `.env.example` ve `README.md` güncellenmeli.
- Yeni mimari karar veya katman eklenirse bu dosya da güncellenmeli.

## CloakBrowser / Playwright Kuralları

- Proje Node.js ve CommonJS kalır; CloakBrowser ESM olduğu için dinamik import adapter içinde kullanılmalıdır.
- `puppeteer` geri eklenmemelidir.
- Playwright/CloakBrowser ayarları tek yerde toplanır: `app/Automation/cloakBrowserClient.js`.
- CloakBrowser humanize ve geoip ayarları config üzerinden yönetilir.
- Browser otomasyonunda mümkün olduğunca Playwright locator/selector aksiyonları kullanılmalıdır; humanize katmanını bypass eden doğrudan DOM click'lerinden kaçınılmalıdır.

## Google Search URL Kuralları

Google arama URL davranışında BrightData'nın Google Search URL Parameters referansı esas alınmalıdır:

- Referans: `https://brightdata.com/blog/web-data/google-search-url-parameters`
- Google query üretimi tek yerde yapılmalıdır: `app/Automation/googleSearchUrl.js`.
- Arama URL'sinde `q` ana parametredir ve URL builder içinde önce set edilmelidir.
- Pagination için `start` kullanılmalıdır: `start=0` ilk sayfa, `start=10` ikinci sayfa, `start=20` üçüncü sayfa.
- `num` parametresi kullanılmamalıdır; 2025 sonrası güvenilir değildir ve Google tarafından yok sayılabilir.
- `pws` opsiyoneldir. Normal kullanıcı SERP'ine yakın davranmak için varsayılan boş kalmalıdır; kişiselleştirmeyi azaltmak veya rank-tracking yapmak için config ile `GOOGLE_SEARCH_PWS=0` verilir.
- `udm` opsiyoneldir. Kullanıcının normal Google "All" sonuçlarına yakın davranmak için varsayılan boş kalmalıdır; klasik web/AI'sız SERP istenirse config ile `GOOGLE_SEARCH_UDM=14` verilir.
- Dil ve ülke hedeflemesi config üzerinden yönetilmelidir: `GOOGLE_SEARCH_HL`, `GOOGLE_SEARCH_GL`.
- Varsayılan Türkiye akışı `hl=tr`, `gl=tr` ile çalışır.
- Google ccTLD üzerinden lokasyon varsayımı yapılmamalıdır; lokasyon davranışı `gl` ve gerekirse browser/proxy geo ayarları ile yönetilmelidir.
- `ei`, `ved`, `sxsrf`, `sstk` gibi session/tracking parametreleri kod tarafından üretilmemelidir.
- Sonuçlar lokasyon, personalization, proxy, browser state ve Google varyasyonları nedeniyle kullanıcının manuel tarayıcısından farklı olabilir; bu yüzden her sayfa kontrolü ve match/not_found sonucu loglanmalıdır.

## Doğrulama

Değişiklikten sonra en az şu kontroller yapılmalıdır:

```bash
find . -path './node_modules' -prune -o -path './.git' -prune -o -name '*.js' -print0 | xargs -0 -n 1 node --check
npm run browser:info
```

Browser davranışını etkileyen değişikliklerde smoke test çalıştır:

```bash
node -e "(async()=>{const {launchContext}=await import('cloakbrowser'); const ctx=await launchContext({headless:true,humanize:false,viewport:{width:800,height:600}}); const page=await ctx.newPage(); await page.goto('https://example.com',{waitUntil:'domcontentloaded',timeout:30000}); console.log(await page.title()); await ctx.close();})().catch(e=>{console.error(e.stack||e.message); process.exit(1);})"
```
