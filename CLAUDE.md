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
- Hesaplar tek tek elle kaydedilebilir veya dosyadan import edilebilir.
- Import formatları `.xlsx`, `.xls`, `.csv`, `.tsv` ve `.txt`'dir.
- Kolon eşleştirme `gmail`, `şifre/sifre`, `2fa` başlıkları üzerinden yapılır.
- Opsiyonel kolonlar `proxy`, `proxyUrl`, `recoveryEmail`, `recoveryPassword`, `telefon/phone`, `not/note/notes` olarak okunabilir.
- Proxy nullable'dır. Dosyada veya formda proxy yoksa akış direkt bağlantıyla devam eder.
- Importtan sonra otomatik üretim seçilebilir. Bu durumda import edilen hesaplar sırayla cookie üretimine alınır.
- Başarılı üretimde cookie'ler MongoDB cookie havuzuna eklenir ve ayrıca `storage/google-auth-cookies/<email>/` altında JSON dosyası olarak yazılır.
- Tek hesap için `Dosya indir`, tüm hesaplar için `Tüm dosyaları indir` aksiyonu vardır.
- `Tümünü sil`, yalnızca Google Auth hesap kayıtlarını MongoDB'den siler; cookie havuzu ve dosya çıktıları korunur.
- Cookie JSON çıktısı `accountId`, `email`, `cookiePoolId`, `generatedAt`, `loginUrl` ve `cookies` alanlarını içerir.
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

- Google Auth login akışındaki reCAPTCHA, 2captcha servisi (`@2captcha/captcha-solver`) ile otomatik çözülür.
- İki katman vardır: saf 2captcha API entegrasyonu `app/Services/captchaSolverService.js` içinde (Playwright/DOM bilgisi yok, hem Google Auth hem Task tarafından kullanılır); browser glue (sitekey okuma + token enjeksiyonu) `app/Automation/recaptchaSolver.js` içindedir. SDK başka katmana sızmaz.
- 2captcha API anahtarı env'den okunmaz. Google Auth sekmesindeki `2captcha API anahtarı` alanından girilir ve çerez üretim isteğiyle (`captchaApiKey`) birlikte servise taşınır. Task tarafında da nullable `captchaApiKey` alanı vardır.
- API anahtarı boşsa otomatik çözüm denenmez; akış mevcut recaptcha davranışına düşer.
- Sitekey ve `data-s` her zaman DOM'dan okunur; sabit sitekey kullanılmaz. Google signin `data-site-key`/`data-enterprise-site-key` ve `data-client-signature` (data-s) kullanır; bunlar ile anchor iframe'in `&s=` parametresi merge edilir. Enterprise/invisible varyantları otomatik algılanır.
- Challenge sayfası `/challenge/recaptcha`'ya widget render olmadan düşebilir; bu yüzden sitekey gelene kadar `waitForRecaptchaParams` ile beklenir (varsayılan 25 sn). Hemen "sitekey not found" denmez.
- Çözülen token `g-recaptcha-response` textarea'sına **sadece `.value`/`.textContent` ile** yazılır. `innerHTML` ATAMASI YASAKTIR: Google signin sayfası Trusted Types zorlar ve `innerHTML` exception fırlatıp tüm enjeksiyonu iptal eder.
- Token yazıldıktan sonra `grecaptcha.getResponse`/`grecaptcha.enterprise.getResponse` override edilir ve `___grecaptcha_cfg.clients` ağacındaki tüm `callback` fonksiyonları token ile tetiklenir (visited-guard'lı tam traversal).
- Enterprise çözümü dakikalar sürebilir; bu sırada sayfa kendini reload edebilir. Enjeksiyon `injectRecaptchaTokenStable` ile "execution context destroyed" yarışına karşı retry'lı yapılır. 2captcha'ya giden ağ koparsa (DNS/bağlantı) çözücü süre dolana dek tekrar dener.
- Otomatik çözüm başarısız olursa headless modda akış `recaptcha_challenge` ile durur; non-headless modda mevcut manuel bekleme path'i korunur.
- **Operasyonel gerçek:** Google'ın KENDİ giriş ekranındaki Enterprise + data-s captcha'sı (tıklayınca resim bulmacasına çıkar) 2captcha tarafından güvenilir çözülemez ("unable to solve after 3 attempts") ve token gelse bile Google sunucu tarafında session/cihaz/risk doğrulamasıyla reddedebilir. Bu, Google login'ine özgü bir kısıttır, kod hatası değildir (aynı kod 2captcha v2 demo'sunda geçer). Prod stratejisi captcha'yı çözmek değil, **temiz residential/mobil proxy + temiz/ısınmış hesap** ile captcha'nın hiç çıkmamasını sağlamaktır; captcha çıkan hesap "yanmış" sayılıp rotate edilmelidir.

## 2FA (TOTP) Kuralları

- 2FA kodu `speakeasy` ile TOTP (base32, 6 hane, 30 sn step) olarak üretilir; üretim/parse tek yerde `app/Automation/googleAuthLogin.js` içindedir.
- TOTP kodu 30 sn pencere sınırında bayatlayıp "Wrong code" verebilir. Bu yüzden kod input görünür olduktan SONRA, `generateTotpWindowSafe` ile üretilir: pencerede ~6 sn'den az kaldıysa bir sonraki pencereye geçilir, böylece kod fill+submit boyunca geçerli kalır.
- "Wrong code"/"Yanlış kod" tespit edilirse (`detectWrongTotpCode`) input temizlenip taze pencere-güvenli kodla en fazla 3 deneme yapılır.
- Her adım loglanır: `2fa_challenge_detected`, `2fa_window_wait`, `2fa_code_generated` (kod maskeli + kalan saniye), `2fa_code_filled`, `2fa_submitted`, `2fa_result` (stillOn2fa/wrongCode).

## Proxy ile Giriş Kuralları

- `generateGoogleAuthCookies` `proxyUrl` alır ve `app/Automation/cloakBrowserClient.js` üzerinden context'e geçirir; kimlikli proxy'ler `anonymizeProxyIfNeeded` ile sarılır.
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
