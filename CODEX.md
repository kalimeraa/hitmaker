# Codex Instructions

Bu dosya Hitmaker projesinde Codex için kalıcı çalışma kurallarıdır. Ana kaynak `AGENTS.md` dosyasıdır; burada yazanlar onun kısa ama operasyonel özetidir. Kullanıcı tekrar söylemese bile her yeni kod bu kurallara göre yazılır.

## Mimari Kural

- Proje Node.js + Express + EJS + MongoDB + Redis + BullMQ ile çalışır.
- Browser otomasyonu Playwright API'si üzerinden CloakBrowser ile yapılır.
- Kod Laravel benzeri MVC yapısında kalır.
- Controller sadece HTTP request/response sınırıdır.
- Model sadece Mongoose veri şeklini taşır.
- View sadece render sorumluluğundadır.
- Service use-case orchestration katmanıdır.
- Repository veri erişimini soyutlar.
- Domain modülleri saf iş kurallarını taşır.
- Automation modülleri browser detaylarını taşır.

## Klasör Sorumlulukları

- `app/Http/Controllers`: Controller katmanı.
- `app/Http/Middleware`: Express middleware.
- `app/Models`: Mongoose modelleri.
- `app/Repositories`: MongoDB query/persistence.
- `app/Services`: Task, queue, worker, run, cancellation, realtime event ve log use-case'leri.
- `app/Domain`: Saf hesaplama ve kararlar.
- `app/Automation`: CloakBrowser, cookie, Google search/click akışları.
- `app/Validators`: Payload doğrulama ve normalize.
- `routes`: Route-to-controller mapping.
- `views`: Layout, partial, page ve component bazlı EJS.
- `public`: Browser JS/CSS assetleri.
- `config`: Environment config.
- `bootstrap`: Runtime bağlantıları.

## SOLID Kuralları

- Controller içine validation, database query, queue publish veya browser logic yazma.
- Repository içine business workflow veya status hesabı yazma.
- Service büyürse yeni service veya domain modülü çıkar.
- Browser launch ayarları sadece `app/Automation/cloakBrowserClient.js` içinde değişir.
- Google URL üretimi sadece `app/Automation/googleSearchUrl.js` içinde yapılır.
- Google sonuç/pagination logic sadece `app/Automation/googleSearchResults.js` içinde kalır.
- Hedefe click sonrası doğal bekleme ve aşağı/yukarı scroll yapılır; hedef sayfadan anında çıkılmaz.
- Queue publish sadece `app/Services/taskJobService.js` sınırında kalır.
- Worker orchestration sadece `app/Services/taskProcessorService.js` içinde kalır.
- Realtime event publish sadece `app/Services/realtimeEventService.js` üzerinden yapılır.

## UI Kuralları

- UI reactive çalışmalıdır.
- Task/log/error değişimleri Redis pub/sub ve `/api/events` SSE stream'i ile anlık akmalıdır.
- Polling veya manuel yenileme ana akış olmamalıdır.
- Task listesi 10'lu pagination ile gösterilir.
- Task içindeki run listeleri 10'lu pagination ile gösterilir.
- Canlı update geldiğinde mevcut task sayfası ve run sayfası korunmalıdır.
- Başarısız run satırında `Retry` butonu olur.
- Retry sadece ilgili run index'ini tekrar kuyruğa alır; task'ın tamamı yeniden oluşturulmaz.
- Başarısız veya `not_found` run satırında `Adresler` modalı olur.
- Adresler modalı candidate kayıtlarını page ascending gösterir.
- Task kartında `Düzenle` butonu olur. Edit aynı task ID'sini korur, run listesini sıfırlar ve task'ı yeni parametrelerle yeniden başlatır.
- Silme hard delete'tir: task MongoDB'den kaldırılır, bekleyen job'lar temizlenir ve UI'dan anında düşer.

## Task ve Queue Kuralları

- Task payload'ında `clickCount` tercih edilir; eski `count` sadece geriye uyumluluk içindir.
- Task payload'ında `maxAttempts` Laravel job `tries` gibi davranır. Varsayılan `3`, kabul edilen aralık `1-10`.
- `durationHours > 0` ise clickler süreye random dağıtılır.
- Run retry job adı `retry-run` olarak kalır.
- Ana task job adı `search-click` olarak kalır.
- Retry progress'i yeniden artırmamalıdır; aynı run sonucu değiştirilmelidir.
- Otomatik run retry progress'i artırmamalıdır; progress sadece final run sonucunda artar.
- Task edit `runVersion` artırır. Aktif run eski version görürse cancel olur.
- Match bulunduğunda `resultPage` ve `resultRank` kaydedilir.
- Aktif task silinirse browser ilk cancellation kontrolünde kapanmalıdır.

## Google Search Kuralları

- BrightData Google Search URL Parameters referansı esas alınır: `https://brightdata.com/blog/web-data/google-search-url-parameters`
- URL builder: `app/Automation/googleSearchUrl.js`.
- Ana query parametresi `q`.
- Pagination sadece URL `start=10`, `start=20` şeklinde yapılır. Google "Next/Sonraki" linkine tıklanmaz.
- `num` kullanılmaz.
- Varsayılan query `q=<keyword>&hl=tr&gl=tr`.
- `pws=0` ve `udm=14` sadece env ile istenirse eklenir.
- `ei`, `ved`, `sxsrf`, `sstk` gibi session/tracking parametreleri kod tarafından üretilmez.
- Cookie uygulamak için hedef siteye preflight navigation yapılmaz; cookie varsa context'e domain bazlı eklenir.
- Google sonuçları kullanıcı Chrome'u ile farklı olabilir; bu yüzden candidates/match/not_found logları korunmalıdır.
- Google `/sorry` veya captcha/challenge döndürürse run `blocked_by_google` olmalıdır.

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

## Local Visible Browser

- Docker'sız görünür test için `./start.sh` kullanılır.
- Script Redis/MongoDB Homebrew servislerini gerekirse başlatır.
- Script app ve worker'ı beraber başlatır.
- `HEADLESS_DEFAULT=false` ve `MAX_PARALLEL_BROWSERS=1` local visible mode varsayılanıdır.
- Headless false browser penceresi maximized açılır.

## Loglama Kuralları

Tüm önemli aksiyonlar logger ile kaydedilir:

- HTTP request
- Task create/delete
- Queue enqueue/completed/failed
- Run start/completed/failed/retry
- Browser context start
- Cookie apply
- Google navigation
- Google page check
- Candidate list
- Match/not_found
- Found page/rank
- Target navigation
- Target human scroll
- Proxy/network/browser errors
- Cancellation/delete path

Loglar MongoDB `logentries` collection'ına yazılır ve `log.created` SSE event'i olarak UI'a akar.

## Doğrulama

Kod değişikliğinden sonra en az:

```bash
find . -path './node_modules' -prune -o -path './.git' -prune -o -name '*.js' -print0 | xargs -0 -n 1 node --check
docker compose config --quiet
```

Docker ile çalışan test:

```bash
docker compose up --build -d --force-recreate
curl -sS http://127.0.0.1:3100/api/health
```

Browser veya worker davranışı değiştiyse gerçek task aç, `/api/tasks/<id>` ve worker loglarını kontrol et. UI değiştiyse `http://localhost:3100` üzerinde canlı update, pagination, retry, delete ve log stream davranışını kontrol et.
