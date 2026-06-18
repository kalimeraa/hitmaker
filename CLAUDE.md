# Claude Instructions

Bu dosya Hitmaker projesinde Claude/agent oturumları için kalıcı çalışma kurallarıdır. Ana kaynak `AGENTS.md` dosyasıdır; burada yazanlar onun operasyonel özetidir. Kullanıcı tekrar söylemese bile her yeni kod bu kurallara göre yazılır.

## Proje Özeti

- Node.js + Express + EJS web/API uygulaması.
- MongoDB task/log kalıcılığı için kullanılır.
- Redis + BullMQ worker kuyruğu için kullanılır.
- CloakBrowser Playwright uyumlu browser context sağlar.
- UI reactive çalışır ve `/api/events` SSE stream'i ile canlı güncellenir.

## MVC ve Katman Kuralları

- HTTP controller dosyaları `app/Http/Controllers` altında kalır.
- Middleware dosyaları `app/Http/Middleware` altında kalır.
- Modeller `app/Models` altında Mongoose schema olarak kalır.
- Repository dosyaları `app/Repositories` altında sadece data access yapar.
- Service dosyaları `app/Services` altında use-case orchestration yapar.
- Domain kararları `app/Domain` altında saf fonksiyon/modül olarak tutulur.
- Browser automation `app/Automation` altında izole edilir.
- Hedef sayfaya gidildikten sonra doğal bekleme ve aşağı/yukarı scroll yapılır; browser hemen kapatılmaz.
- View katmanı `views` altında layout, partial, page ve component olarak modüler tutulur.
- `public` sadece browser JS/CSS asset içindir.

Controller'a iş kuralı, repository'ye workflow, model'e queue/browser logic yazılmaz.

## SOLID Kuralları

- Her dosyanın tek değişme sebebi olmalıdır.
- Yeni davranış mevcut sınırlara uygun service/domain/automation modülüyle eklenmelidir.
- Queue, browser, realtime event ve repository sınırları birbirine karıştırılmamalıdır.
- Geniş dependency objeleri yerine ihtiyaç duyulan dar bağımlılıklar kullanılmalıdır.
- Yeni route sadece controller method'una bağlanmalı; route dosyasında iş kuralı yazılmamalıdır.

## UI Kuralları

- UI polling veya manuel refresh'e bağımlı olmamalıdır.
- Task, run, log ve error değişimleri `app/Services/realtimeEventService.js` üzerinden Redis pub/sub ile yayınlanır.
- Browser `/api/events` SSE stream'ini dinler.
- Task listesi 10'lu pagination ile gösterilir.
- Her task içindeki run listesi 10'lu pagination ile gösterilir.
- Canlı update geldiğinde mevcut pagination state korunmalıdır.
- Başarısız runlarda `Retry` butonu görünür.
- Retry sadece ilgili run'ı tekrar çalıştırır; task'ın tüm run listesi yeniden oluşturulmaz.
- Task kartında `Düzenle` butonu bulunur. Edit aynı task ID'sini korur, run listesini sıfırlar ve task'ı yeni parametrelerle yeniden kuyruğa alır.
- `Sil` hard delete yapar; task MongoDB'den kaldırılır ve bekleyen job'lar temizlenir.

## Task Davranışı

- Task payload için yeni alan `clickCount`; eski `count` geriye uyumluluk içindir.
- `durationHours`, clickleri belirtilen saat aralığına random dağıtır.
- Run status değerleri: `queued`, `running`, `clicked`, `not_found`, `failed`.
- Task status değerleri: `queued`, `running`, `completed`, `failed`, eski kayıtlarda `cancelled`.
- Run retry progress'i ikinci kez artırmamalıdır.
- Run otomatik retry `maxAttempts` ile yönetilir; varsayılan değer 3'tür.
- Task edit `runVersion` artırır ve aktif eski run'ları cancellation path'iyle durdurur.
- Match bulunduğunda `resultPage` ve `resultRank` kaydedilir.
- Aktif run silinen taskı ilk cancellation kontrolünde durdurmalıdır.

## Google Search Kuralları

- Google URL üretimi sadece `app/Automation/googleSearchUrl.js` içinde yapılır.
- BrightData referansı dikkate alınır: `https://brightdata.com/blog/web-data/google-search-url-parameters`
- Varsayılan query `q=<keyword>&hl=tr&gl=tr`.
- Pagination `start=10`, `start=20` ile yapılır.
- `num` kullanılmaz.
- `pws=0` ve `udm=14` varsayılan değildir; sadece env ile istenirse eklenir.
- `ei`, `ved`, `sxsrf`, `sstk` gibi tracking/session parametreleri üretilmez.
- Cookie uygulamak için hedefe ön navigation yapılmaz; cookie varsa Playwright context'e domain bazlı eklenir.
- Google SERP kullanıcı tarayıcısından farklı olabilir. Bu yüzden `google_results_candidates_seen`, match ve not_found logları korunmalıdır.

## Google Auth Kuralları

- Google Auth sekmesi lokal hesap havuzu, cookie üretimi ve cookie dosyası yönetimi içindir.
- Hesaplar **yalnızca dosyadan import** edilir; manuel tek-hesap kayıt formu kaldırıldı (akış import-odaklı).
- Import formatları `.xlsx`, `.xls`, `.csv`, `.tsv` ve `.txt`'dir.
- Kolon eşleştirme `gmail`, `şifre/sifre`, `2fa` başlıkları üzerinden yapılır.
- Opsiyonel kolonlar `proxy`, `proxyUrl`, `recoveryEmail`, `recoveryPassword`, `telefon/phone`, `not/note/notes` olarak okunabilir.
- UI'da **tek bir "Proxy" alanı** vardır (`#googleAuthProxyUrl`); hem importta atanan proxy hem çerez üretim proxy'si odur. Eski "Hesap proxy"/"Tek proxy"/structured builder kaldırıldı. Structured proxy-builder (`views/home/components/proxyBuilder.ejs`) yalnızca Task formunda kullanılır.
- Proxy nullable'dır. Proxy yoksa akış direkt bağlantıyla devam eder.
- Importtan sonra otomatik üretim seçilebilir. Bu durumda import edilen hesaplar sırayla cookie üretimine alınır.
- Çerez üretim payload alanları: `proxyUrl`, `captchaApiKey`, `proxyResetUrl`, `maxAttempts` (1-5, default 3), `headless`, `deviceMode`, `notes`.
- Başarılı üretimde cookie'ler MongoDB cookie havuzuna eklenir ve ayrıca `storage/google-auth-cookies/<email>/` altında JSON dosyası olarak yazılır.
- Tek hesap için `Dosya indir`, tüm hesaplar için `Tüm dosyaları indir` aksiyonu vardır.
- `Tümünü sil`, yalnızca Google Auth hesap kayıtlarını MongoDB'den siler; cookie havuzu ve dosya çıktıları korunur.
- Cookie JSON çıktısı `accountId`, `email`, `cookiePoolId`, `generatedAt`, `loginUrl` ve `cookies` alanlarını içerir.
- Hesap modelinde `lastChallenge` alanı son üretimi durduran challenge'ı tutar (`phone_verification` | `recaptcha_challenge` | `2fa_challenge` | `unsafe_browser` | ""); UI listesinde rozet olarak gösterilir (`phone_verification` = kırmızı "yanmış"). Başarılı üretimde temizlenir.
Google Auth HTTP endpoint'leri:

```http
GET    /api/google-auth
POST   /api/google-auth
POST   /api/google-auth/import
PUT    /api/google-auth/:id
POST   /api/google-auth/:id/cookies
GET    /api/google-auth/:id/cookies/download
GET    /api/google-auth/cookies/download-all
DELETE /api/google-auth/:id
DELETE /api/google-auth
```

Google Auth ile ilgili önemli log event'leri:

- `google_auth_accounts_imported`
- `google_auth_cookie_generation_started`
- `google_auth_attempt_started` / `google_auth_attempt_failed` (IP-rotasyon-retry döngüsü; `decision: retry|terminal`)
- `google_auth_proxy_reset_started` / `google_auth_proxy_reset_completed` / `google_auth_proxy_reset_failed` (provider IP reset)
- `google_auth_warmup_started` / `google_auth_warmup_visited` / `google_auth_warmup_completed` / `google_auth_warmup_failed`
- `google_auth_search_captcha_detected` / `_skipped` / `_failed` / `_result` (warmup'taki /sorry captcha)
- `google_auth_phone_verification_required` (telefon SMS duvarı — hesap yanmış)
- `google_auth_recaptcha_manual_wait` (görünür modda elle çözüm bekleniyor)
- `google_auth_email_step_started`
- `google_auth_email_step_completed`
- `google_auth_password_step_started`
- `google_auth_password_step_completed`
- `google_auth_cookies_collected`
- `google_auth_cookie_generation_completed`
- `google_auth_cookie_bundle_created`
- `google_auth_recaptcha_required`
- `google_auth_captcha_sitekey_resolved`
- `google_auth_captcha_sitekey_wait_timeout`
- `google_auth_captcha_solve_started`
- `google_auth_captcha_dom_inspected` (sadece `CAPTCHA_DEBUG=1`)
- `google_auth_captcha_solved`
- `google_auth_captcha_solve_failed`
- `google_auth_captcha_submit_started`
- `google_auth_captcha_submit_result`
- `google_auth_captcha_attempt_failed`
- `google_auth_recaptcha_completed`
- `google_auth_2fa_challenge_detected`
- `google_auth_2fa_window_wait`
- `google_auth_2fa_code_generated`
- `google_auth_2fa_code_filled`
- `google_auth_2fa_submitted`
- `google_auth_2fa_result`
- `google_auth_2fa_failed`

## Captcha Çözüm Kuralları

- Google Auth login akışındaki reCAPTCHA, 2captcha ile otomatik çözülmeye çalışılır.
- İki katman vardır: saf 2captcha API entegrasyonu `app/Services/captchaSolverService.js` içinde (Playwright/DOM bilgisi yok); browser glue (sitekey okuma + token enjeksiyonu) `app/Automation/recaptchaSolver.js` içindedir.
- **`captchaSolverService` artık legacy `@2captcha/captcha-solver` SDK yerine yeni `api.2captcha.com/createTask`/`getTaskResult` API'sini doğrudan `fetch` ile kullanır.** Enterprise için `RecaptchaV2EnterpriseTask` + `enterprisePayload: { s: dataS }` + `apiDomain: "google.com"`; non-enterprise için `RecaptchaV2Task` + `recaptchaDataSValue`. Sebep: legacy `datas` param'ı enterprise'da yeterli değil; `s` değeri `enterprisePayload` içinde gönderilmeli (SDK bunu desteklemiyor).
- **Token IP'ye bağlıdır.** 2captcha'ya bizim **proxy'miz** (`proxyType/proxyAddress/proxyPort/proxyLogin/proxyPassword`) + `userAgent` + `cookies` (`name=value; ...` formatı) geçirilir ki worker bizim exit IP'mizden çözsün. Proxy `recaptchaSolver`'da `proxyUrlToSolverProxy` ile parse edilir.
- 2captcha API anahtarı env'den okunmaz; Google Auth `2captcha API anahtarı` alanından gelir (`captchaApiKey`).
- API anahtarı boşsa otomatik çözüm denenmez; görünür modda elle çözüm beklenir.
- **2captcha SADECE headless modda çağrılır.** Görünür modda (`headless=false`) otomatik çözüm yapılmaz — kullanıcı captcha'yı elle çözer, `waitForManualRecaptchaIfNeeded` captcha temizlenir temizlenmez (~1.5sn poll) devam eder. Sebep: signin token'ı zaten reddediliyor + ekranda insan var (`google_auth_recaptcha_manual_wait`).
- Sitekey ve `data-s` her zaman DOM'dan okunur; sabit sitekey kullanılmaz. Google signin `data-site-key`/`data-enterprise-site-key` ve `data-client-signature` (data-s) kullanır; bunlar ile anchor iframe'in `&s=` parametresi merge edilir. Enterprise/invisible varyantları otomatik algılanır.
- Challenge sayfası `/challenge/recaptcha`'ya widget render olmadan düşebilir; bu yüzden sitekey gelene kadar `waitForRecaptchaParams` ile beklenir (varsayılan 25 sn). Hemen "sitekey not found" denmez.
- Çözülen token `g-recaptcha-response` textarea'sına **sadece `.value`/`.textContent` ile** yazılır. `innerHTML` ATAMASI YASAKTIR: Google signin sayfası Trusted Types zorlar ve `innerHTML` exception fırlatıp tüm enjeksiyonu iptal eder.
- Token yazıldıktan sonra `grecaptcha.getResponse`/`grecaptcha.enterprise.getResponse` override edilir ve `___grecaptcha_cfg.clients` ağacındaki tüm `callback` fonksiyonları token ile tetiklenir (visited-guard'lı tam traversal).
- Enterprise çözümü dakikalar sürebilir; bu sırada sayfa kendini reload edebilir. Enjeksiyon `injectRecaptchaTokenStable` ile "execution context destroyed" yarışına karşı retry'lı yapılır. 2captcha'ya giden ağ koparsa (DNS/bağlantı) çözücü süre dolana dek tekrar dener.
- Otomatik çözüm başarısız olursa headless modda akış `recaptcha_challenge` ile durur; non-headless modda mevcut manuel bekleme path'i korunur.
- **Operasyonel gerçek (bu oturumda KANITLANDI):** Google'ın KENDİ giriş ekranındaki Enterprise captcha'sı token-injection ile **aşılamaz.** 2captcha token'ı çözüp döndürse bile (`captcha_solved` → `injectedInto:1, getResponseOverridden:true, callbackInvoked:true`, `tokenBound: getResponseLen=2446`), Next'e basıldığında Google captcha'yı **tutar** (`recaptcha_still_present_after_solve`, `urlChanged:false`). Token GEÇERLİDİR (aynı token 2captcha demo enterprise sayfasında geçer) — Google **server-side** "bu token bir captcha-farm'ı tarafından, bu oturumdaki gerçek kullanıcı değil çözdü" diye reddeder. Bu solver-bağımsızdır (2captcha API, extension ve CapSolver de aynı duvara çarpar; extension reCAPTCHA'da yine token-injection yapar, "in-context" çözmez). **Hiçbir token-tabanlı çözüm Google signin'ini geçemez.**
- **Tek gerçek yollar:** (1) **görünür mod + insan** captcha/gesture/telefonu elle çözer (farm değil → Google kabul eder); (2) captcha'yı **hiç çıkartmama** — temiz/dedicated IP + ısınmış/yaşlandırılmış/telefon-doğrulanmış hesap. Captcha çıkan hesap pratikte "yanmış"tır; telefon (SMS) duvarı çıkan hesap hesap-seviyesinde yanmıştır (IP rotasyonu kurtarmaz).
- Captcha çıkmasını AZALTAN önlemler (kanıt: bunlar gerekli ama tek başına yetmez): hesap-başına kalıcı profil (`storage/profiles/<id>`, cihaz tutarlılığı), sabit fingerprint, güçlü insan-davranışı (eğri mouse, typo, hover-click), gerçek-gezinme warmup (arama→sonuç tıklama→site gezme), yavaş + düşük hacim. Bunlar **temiz hesaplarda zamanla güven inşa eder**, yanmış toplu batch'i kurtarmaz.

## 2FA (TOTP) Kuralları

- 2FA kodu `speakeasy` ile TOTP (base32, 6 hane, 30 sn step) olarak üretilir; üretim/parse tek yerde `app/Automation/googleAuthLogin.js` içindedir.
- TOTP kodu 30 sn pencere sınırında bayatlayıp "Wrong code" verebilir. Bu yüzden kod input görünür olduktan SONRA, `generateTotpWindowSafe` ile üretilir: pencerede ~6 sn'den az kaldıysa bir sonraki pencereye geçilir, böylece kod fill+submit boyunca geçerli kalır.
- "Wrong code"/"Yanlış kod" tespit edilirse (`detectWrongTotpCode`) input temizlenip taze pencere-güvenli kodla en fazla 3 deneme yapılır.
- Her adım loglanır: `2fa_challenge_detected`, `2fa_window_wait`, `2fa_code_generated` (kod maskeli + kalan saniye), `2fa_code_filled`, `2fa_submitted`, `2fa_result` (stillOn2fa/wrongCode).

## Proxy, IP Rotasyon ve Profiling Kuralları

- `generateGoogleAuthCookies` `proxyUrl` alır ve `app/Automation/cloakBrowserClient.js` üzerinden context'e geçirir; kimlikli HTTP proxy'ler `anonymizeProxyIfNeeded` (proxy-chain) ile yerel proxy'ye sarılır.
- **Chromium kimlikli (user:pass) SOCKS5 proxy'yi DESTEKLEMEZ** (bilinen kısıt). Bu yüzden `socks5://user:pass@...` tünel patlatır; auth'lu proxy'lerde **HTTP** kullanılır. SOCKS5 ancak panel IP whitelist (kimliksiz) ile kullanılabilir.
- **Proxy provider abstraction** `app/Services/proxyProviderService.js`: bir provider kontratı (`name`, `label`, `manualReset`, `hostPattern`, `resetIp({resetUrl,onEvent,settleMs})`). `buymobileproxy` provider'ı host'tan **otomatik algılanır** (`detectProxyProvider` — host'ta `buymobileproxy` geçerse). Yeni mobil proxy servisi = PROVIDERS'a yeni giriş.
- **Mobil proxy IP'si login ortasında dönerse Google maksimum bot sinyali alır** (her 30sn rotasyon = email IP-A'dan, şifre IP-B'den → captcha→gesture→telefon). Çözüm: panelde IP yenileme aralığını **Manuel** yap; provider reset link'i (`proxyResetUrl`, UI'da yalnızca buymobileproxy proxy girilince çıkar) ile **hesap başına TEK SEFER taze IP** al, login o sabit IP'de yapılır. Reset sonrası `DEFAULT_SETTLE_MS=12000` bekle (yeni mobil IP otursun).
- **IP-rotasyon-retry algoritması** `googleAuthService.generateCookies` içinde: `maxAttempts` (default 3) denemelik döngü; her denemede taze IP + baştan login. `classifyLoginFailure` sonucu `retry` (captcha/unsafe/tünel → taze IP'yle tekrar) veya `terminal` (`phone_verification`=yanmış, `2fa_challenge` → retry yok) olarak sınıflar. Reset yoksa `maxAttempts=1`.
- **Hesap-başına kalıcı profil (browser profiling):** `cloakBrowserClient.launchBrowserContext({ profileKey })` verilirse DAİMA `storage/profiles/<accountId>` izole persistent context kullanır (cookie/history/fingerprint kalıcı = Google için "aynı cihaz"). `generateCookies` `profileKey: account._id` geçirir. Tek paylaşımlı profil cross-contamination yapar; per-account zorunlu. Profil retry döngüsünde tekrar açılır — her deneme context'i `finally`'de kapatır (sıralı kullanım).
- **İnsan davranışı** (`app/Automation/googleAuthLogin.js`): `humanMouseMove` eğri/çok-noktalı hareket + molalar; `humanHoverClick` öğeye gidip tıklar; `humanType` ~%8 komşu-tuş typo + backspace düzeltme + molalar; `humanScroll` wheel tabanlı çok-tur.
- **Güçlü warmup** (`warmUpSession`): login'den önce google→1-2 doğal arama→**organik sonuca tıkla→gerçek sitede gez/oku/scroll→geri dön** (`clickOrganicResultAndBrowse`)→youtube. Warmup'ta /sorry captcha çıkarsa 2captcha ile çözülür (`solveGoogleSorryIfPresent` — bu tip token-injection ile geçer ve IP "unusual traffic" bloğunu kaldırır, signin'den farklı). `GAUTH_WARMUP=0` ile kapatılır.
- Görünür/proxy'li manuel test için `htmls/smoke-google-auth.js` env üzerinden `GAUTH_PROXY` okur (repo'ya secret yazılmaz). Captcha/2FA davranışını incelemek için `htmls/captcha-hunt.js` `ACCOUNTS_FILE` + `GAUTH_PROXY` + `CAPTCHA_DEBUG=1` ile çalışır. Saf entegrasyon kanıtı için `htmls/demo-recaptcha-v2.js` 2captcha v2 demo'su üzerinde "Captcha is passed successfully!" doğrular.

## Loglama Kuralları

Her önemli aksiyon loglanır:

- HTTP request
- Task create/delete
- Queue enqueue/completed/failed
- Run start/completed/failed/retry
- Browser context start
- Cookie apply
- Google navigation/page check/candidates
- Match/not_found
- Found page/rank
- Target navigation
- Target human scroll
- Proxy/network/browser errors

Loglar console'a ve MongoDB `logentries` collection'ına yazılır. Ayrıca `log.created` event'iyle UI'a canlı akar.

## Doğrulama

Kod değişikliğinden sonra:

```bash
find . -path './node_modules' -prune -o -path './.git' -prune -o -name '*.js' -print0 | xargs -0 -n 1 node --check
docker compose config --quiet
```

Docker doğrulama:

```bash
docker compose up --build -d --force-recreate
curl -sS http://127.0.0.1:3100/api/health
```

Browser/worker değişikliğinde gerçek task açıp `/api/tasks/<id>` ve worker logları kontrol edilmelidir. UI değişikliğinde `http://localhost:3100` üzerinde canlı update, pagination, retry, delete ve log stream davranışı doğrulanmalıdır.
