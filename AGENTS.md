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
- `app/Services/realtimeEventService.js`: Redis pub/sub üzerinden canlı UI eventleri yayınlama sınırıdır.
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
- Hedef siteye gidildikten sonra browser hemen kapanmamalıdır. `app/Automation/googleClick.js` içinde kısa bekleme, doğal aşağı/yukarı scroll ve final bekleme yapılmalı; bu aksiyonlar loglanmalıdır.
- Google araması başlamadan önce hedef siteye preflight navigation yapılmamalı. Cookie gerekiyorsa `app/Automation/browserCookies.js` ile Playwright context'e domain bazlı eklenmelidir.
- Cookie dönüşümü sadece `app/Automation/browserCookies.js` içinde kalmalı.
- Queue publish sadece `app/Services/taskJobService.js` sınırında kalmalı.
- Worker orchestration sadece `app/Services/taskProcessorService.js` içinde kalmalı.
- Yeni route eklenirse kaynak bazlı route dosyası aç veya mevcut kaynak route'una ekle; `routes/index.js` sadece router mount etsin.
- Task lifecycle, worker lifecycle, browser navigation, Google sayfalama, proxy kullanımı, click sonucu, hata ve cancellation dahil tüm önemli aksiyonlar `app/Services/logService.js` logger'ı ile loglanmalı.
- UI manuel yenileme veya polling'e bağımlı olmamalıdır. Task, run, log ve error değişimleri `app/Services/realtimeEventService.js` üzerinden Redis pub/sub ile yayınlanmalı ve `/api/events` SSE stream'i üzerinden browser'a anlık akmalıdır.
- Task listesi ve task içindeki run listeleri 10'lu sayfalama ile gösterilmelidir. Canlı event geldiğinde mevcut sayfa korunarak yeniden render edilmelidir.
- Başarısız run retry davranışı run seviyesinde kalmalıdır. Retry endpoint'i sadece ilgili run'ı tekrar kuyruğa almalı; task'ın tüm run listesini yeniden oluşturmamalıdır.
- Run başına Laravel job `tries` benzeri `maxAttempts` davranışı korunmalıdır. Varsayılan `3` denemedir; `not_found` ve sistemsel hata sonuçları aynı run index'i üzerinde otomatik tekrar denenir. Ara retry'lar progress'i artırmamalıdır.
- Manuel `Retry`, ilgili run'ın attempt/candidate/result alanlarını sıfırlayıp aynı run index'i için yeniden `maxAttempts` döngüsünü başlatmalıdır.
- Task edit aynı task ID'sini korumalı, `runVersion` artırmalı, bekleyen job'ları temizlemeli, runs/progress alanlarını sıfırlamalı ve task'ı yeni payload ile yeniden kuyruğa almalıdır.
- Google SERP adayları sadece logda kalmamalı; her run'ın `candidates` alanına `pageNumber`, `host`, `path`, `href`, `text` olarak kaydedilmelidir.
- Match bulunduğunda run içinde `resultPage` ve `resultRank` kaydedilmelidir. UI bunu link yanında `page X · rank Y` şeklinde göstermelidir.
- UI'da başarısız veya `not_found` run için `Adresler` modalı bulunmalıdır. Aday liste boşsa modal Google'ın `sorry`/captcha/challenge veya hata sayfası döndürmüş olabileceğini açıkça göstermelidir.
- Aday adres modalında kayıtlar page ascending sıralanmalıdır; page 1 adayları üstte, son sayfa adayları altta görünmelidir.
- Task silme hard delete davranışıdır. Task MongoDB'den kaldırılmalı, bekleyen BullMQ job'ları temizlenmeli ve `task.deleted` event'i yayınlanmalıdır.
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

## Google Auth / Captcha / 2FA Kuralları

- Google Auth login otomasyonu `app/Automation/googleAuthLogin.js` içindedir; cookie üretimi orchestration'ı `app/Services/googleAuthService.js` sınırında kalır.
- 2captcha entegrasyonu iki katmana ayrılır: saf API servisi `app/Services/captchaSolverService.js` (Playwright/DOM bilmez; hem Google Auth hem Task tarafından kullanılır), browser glue `app/Automation/recaptchaSolver.js` (sitekey okuma + token enjeksiyonu). `@2captcha/captcha-solver` SDK'sı bu iki dosya dışına sızmamalıdır.
- 2captcha API anahtarı env'den okunmaz; UI'dan gelen `captchaApiKey` ile request bazlı taşınır. Task modelinde de nullable `captchaApiKey` alanı bulunur.
- Sitekey/`data-s` daima DOM'dan okunur (`data-sitekey`, `data-site-key`, `data-enterprise-site-key`, `data-client-signature` ve anchor iframe `&s=`); sabit sitekey gömülmez. Challenge sayfası widget render etmeden gelebileceği için sitekey gelene kadar beklenmelidir.
- Token enjeksiyonunda `innerHTML` ataması yasaktır (Google signin Trusted Types zorlar); sadece `.value`/`.textContent` kullanılır, ardından `getResponse` override edilir ve tüm reCAPTCHA `callback`'leri tetiklenir. Uzun enterprise çözümünde sayfa reload yarışına karşı enjeksiyon retry'lı olmalıdır.
- TOTP (2FA) kodu pencere-güvenli üretilmelidir: 30 sn pencere sınırında bayatlamayı önlemek için input görünür olduktan sonra üretilir, az süre kaldıysa sonraki pencereye geçilir, "Wrong code" tespit edilirse taze kodla retry edilir.
- Captcha ve 2FA akışının tüm adımları event olarak loglanmalı; gerçek sorun loglardan teşhis edilebilmelidir.
- `captchaSolverService` yeni `api.2captcha.com/createTask` API'sini kullanır (legacy SDK değil): enterprise için `RecaptchaV2EnterpriseTask` + `enterprisePayload:{s}` + `apiDomain` + IP-eşleşmeli proxy/userAgent/cookies.
- **Kanıtlanmış kısıt:** Google'ın KENDİ signin enterprise captcha'sı token-injection ile geçilemez — token çözülüp doğru enjekte edilse (`getResponseLen>0`) ve Next'e basılsa bile Google server-side reddeder (`recaptcha_still_present`). Solver-bağımsız (2captcha/CapSolver/extension hepsi aynı duvar; extension reCAPTCHA'da yine token-injection yapar). Tek yol: görünür mod + insan, veya captcha'yı hiç çıkartmayacak temiz hesap/IP.
- **2captcha sadece headless'ta çağrılır; görünür modda insan elle çözer** (`waitForManualRecaptchaIfNeeded` captcha temizlenince anında devam eder).
- **IP-rotasyon-retry:** `generateCookies` `maxAttempts` döngüsüyle her denemede taze IP (provider reset) alır; `classifyLoginFailure` retry/terminal kararı verir. Provider abstraction `app/Services/proxyProviderService.js` (buymobileproxy host'tan auto-detect, manuel reset link). Kimlikli SOCKS5 Chromium'da çalışmaz → HTTP kullanılır.
- **Hesap-başına kalıcı profil (browser profiling):** `launchBrowserContext({profileKey})` → `storage/profiles/<accountId>` (cihaz tutarlılığı). İnsan davranışı (eğri mouse, typo, hover-click) + gerçek-gezinme warmup (sonuç tıklama/site gezme) güçlendirildi.
- Hesap modelinde `lastChallenge` (phone_verification|recaptcha_challenge|2fa_challenge|unsafe_browser) → UI'da "yanmış" rozeti. Telefon (SMS) duvarı = hesap-seviyesinde yanmış. Google Auth UI import-odaklı: manuel kayıt formu kaldırıldı, tek "Proxy" alanı.

## Google Search URL Kuralları

Google arama URL davranışında BrightData'nın Google Search URL Parameters referansı esas alınmalıdır:

- Referans: `https://brightdata.com/blog/web-data/google-search-url-parameters`
- Google query üretimi tek yerde yapılmalıdır: `app/Automation/googleSearchUrl.js`.
- Arama URL'sinde `q` ana parametredir ve URL builder içinde önce set edilmelidir.
- Pagination için sadece URL `start` parametresi kullanılmalıdır: `start=0` ilk sayfa, `start=10` ikinci sayfa, `start=20` üçüncü sayfa. Google "Next/Sonraki" linkine tıklanmaz; bazı SERP varyasyonlarında bu query'yi arama önerisine çevirebilir.
- `num` parametresi kullanılmamalıdır; 2025 sonrası güvenilir değildir ve Google tarafından yok sayılabilir.
- `pws` opsiyoneldir. Normal kullanıcı SERP'ine yakın davranmak için varsayılan boş kalmalıdır; kişiselleştirmeyi azaltmak veya rank-tracking yapmak için config ile `GOOGLE_SEARCH_PWS=0` verilir.
- `udm` opsiyoneldir. Kullanıcının normal Google "All" sonuçlarına yakın davranmak için varsayılan boş kalmalıdır; klasik web/AI'sız SERP istenirse config ile `GOOGLE_SEARCH_UDM=14` verilir.
- Dil ve ülke hedeflemesi config üzerinden yönetilmelidir: `GOOGLE_SEARCH_HL`, `GOOGLE_SEARCH_GL`.
- Varsayılan Türkiye akışı `hl=tr`, `gl=tr` ile çalışır.
- Google ccTLD üzerinden lokasyon varsayımı yapılmamalıdır; lokasyon davranışı `gl` ve gerekirse browser/proxy geo ayarları ile yönetilmelidir.
- `ei`, `ved`, `sxsrf`, `sstk` gibi session/tracking parametreleri kod tarafından üretilmemelidir.
- Sonuçlar lokasyon, personalization, proxy, browser state ve Google varyasyonları nedeniyle kullanıcının manuel tarayıcısından farklı olabilir; bu yüzden her sayfa kontrolü, candidate list, match/not_found ve `google.com/sorry` gibi challenge URL'leri loglanmalıdır.
- Google'a gitmeden önce geçersiz hedef domainleri ziyaret etmek `chrome-error://chromewebdata` navigation yarışına sebep olabilir; bu yüzden hedef preflight yasaktır.
- Google `/sorry`/captcha/challenge döndürürse run `blocked_by_google` olarak ayrıştırılmalıdır; bu durum `not_found` ile karıştırılmamalıdır.

## Local Visible Browser Kuralları

- Docker'sız görünür test için `./start.sh` kullanılır.
- Script local Redis ve MongoDB kapalıysa Homebrew services ile başlatmayı denemelidir.
- `./start.sh` app ve worker'ı beraber başlatır; `HEADLESS_DEFAULT=false`, `MAX_PARALLEL_BROWSERS=1` ve UI portu varsayılan `3100` olmalıdır.
- Headless false browser akışı fullscreen/maximized açılmalıdır. Bu davranış sadece `app/Automation/cloakBrowserClient.js` sınırında yönetilmelidir.

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
