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

- `models/`: Mongoose schema ve model tanımları. Sadece veri şekli, doğrulama ve model seviyesindeki basit kısıtlar burada olmalıdır.
- `repositories/`: MongoDB/Mongoose erişimi. Query, create, update ve persistence detayları burada kalır.
- `domain/`: Saf iş kuralları ve hesaplamalar. Database, queue, HTTP veya browser dependency'si almamalıdır.
- `validators/`: HTTP payload normalize ve validate eder. Request body'sini uygulama içi DTO'ya çevirir.
- `services/`: Use-case ve orchestration katmanı. Controller'dan gelen işi repository, domain, queue ve automation adapter'larına dağıtır.
- `controllers/`: HTTP request/response sınırı. Sadece service çağırır, status code döner, JSON body üretir veya view render eder.
- `views/`: EJS template katmanı. HTML burada tutulur; iş kuralı, database erişimi veya queue/browser logic içermez. View'lar layout, partial, page ve component olarak bölünmelidir.
- `routes/`: Express route tanımları. Sadece endpoint ile controller method eşleştirir.
- `automation/`: Browser otomasyon adapter ve akışları. Database, queue veya HTTP response bilmemelidir.
- `middleware/`: Express middleware'leri. Cross-cutting HTTP davranışları burada kalır.
- `utils/`: Framework bağımsız küçük yardımcı fonksiyonlar.

## Mevcut Akış

1. `routes/webRoutes.js`, `/` sayfasını `controllers/homeController.js` içine yönlendirir.
2. `controllers/homeController.js`, `views/home/index.ejs` view'ını render eder.
3. `routes/taskRoutes.js` task endpoint'lerini `controllers/taskController.js` içine yönlendirir.
4. `controllers/taskController.js`, `services/taskService.js` çağırır.
5. `services/taskService.js`, payload'ı validator ile normalize eder, task'ı repository ile kaydeder ve `services/taskJobService.js` üzerinden BullMQ kuyruğuna gönderir.
6. `worker.js`, BullMQ job'unu `services/taskProcessorService.js` ile işler.
7. `services/taskProcessorService.js`, run planını `domain/taskRunPlanner.js` ile üretir ve concurrency ile `services/taskRunService.js` çağırır.
8. `services/taskRunService.js`, run durumunu repository ile günceller ve `automation/googleClick.js` üzerinden browser akışını çalıştırır.
9. `automation/cloakBrowserClient.js`, CloakBrowser + Playwright context oluşturmanın tek sahibidir.

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
- Browser launch ayarları sadece `automation/cloakBrowserClient.js` içinde değiştirilmeli.
- Cookie dönüşümü sadece `automation/browserCookies.js` içinde kalmalı.
- Queue publish sadece `services/taskJobService.js` sınırında kalmalı.
- Worker orchestration sadece `services/taskProcessorService.js` içinde kalmalı.
- Yeni route eklenirse kaynak bazlı route dosyası aç veya mevcut kaynak route'una ekle; `routes/index.js` sadece router mount etsin.
- HTML sayfası gerekiyorsa `public/*.html` yazma; `views/` altında EJS view oluştur ve controller üzerinden render et.
- View tek büyük dosya olmamalı. Shell için `views/layouts/`, tekrar eden parçalar için `views/partials/`, sayfa içeriği için kaynak bazlı klasörler ve küçük UI parçaları için `components/` kullan.
- Async controller hataları `middleware/asyncHandler.js` ile yakalanmalı.
- Yeni env değişkeni eklenirse `.env.example` ve `README.md` güncellenmeli.
- Yeni mimari karar veya katman eklenirse bu dosya da güncellenmeli.

## CloakBrowser / Playwright Kuralları

- Proje Node.js ve CommonJS kalır; CloakBrowser ESM olduğu için dinamik import adapter içinde kullanılmalıdır.
- `puppeteer` geri eklenmemelidir.
- Playwright/CloakBrowser ayarları tek yerde toplanır: `automation/cloakBrowserClient.js`.
- CloakBrowser humanize ve geoip ayarları config üzerinden yönetilir.
- Browser otomasyonunda mümkün olduğunca Playwright locator/selector aksiyonları kullanılmalıdır; humanize katmanını bypass eden doğrudan DOM click'lerinden kaçınılmalıdır.

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
