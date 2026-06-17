# Hitmaker

Node.js tabanlı Google task runner. Express HTTP katmanı EJS view render eder, API route'ları task oluşturur/siler, BullMQ işleri Redis kuyruğuna alır, worker her run'ı MongoDB'ye kaydeder ve browser otomasyonunu Playwright API'si üzerinden CloakBrowser ile çalıştırır.

## Mevcut Durum

- Runtime: Node.js, Express, EJS, MongoDB, Redis, BullMQ.
- Browser: CloakBrowser paketi üzerinden Playwright uyumlu `BrowserContext`.
- UI: Server-rendered EJS + `public/app.js`.
- Docker UI portu: `http://localhost:3100`.
- Panel girişi varsayılan olarak `hitmaker` / `hitmaker34716` bilgileriyle korunur ve JWT token HttpOnly cookie olarak saklanır.
- Container içi app portu: `3000`.
- Redis ve MongoDB Docker Compose içinde host portu yayınlamaz; başka projelerdeki Redis/Mongo portlarıyla çakışmaz.
- Task silme desteklenir. Silinen task MongoDB'den kaldırılır, bekleyen BullMQ job'ları kaldırılır ve aktif run ilk cancellation kontrolünde kapanır.
- Google sonucu ilk sayfada bulunamazsa `GOOGLE_MAX_RESULT_PAGES` kadar sayfa sayfa aranır.
- Run başına Laravel job `tries` benzeri retry vardır. Varsayılan `maxAttempts` değeri `3`'tür; başarısız veya `not_found` run aynı run index'i üzerinde tekrar denenir.
- Tüm önemli aksiyonlar loglanır: request, task create/delete, queue, run start/end/fail/retry, browser navigation, Google page check, candidate list, match/not_found ve error.
- UI reactive çalışır. Task, log ve hata değişimleri Redis pub/sub üzerinden `/api/events` SSE stream'ine akar; sayfayı yenilemeden task kartları ve log ekranı anlık güncellenir.
- Task listesi 10'lu sayfalama ile gösterilir. Her task kartının içindeki run listesi de 10'lu sayfalıdır.
- Docker'sız görünür browser testi için `./start.sh` kullanılır. Script local Redis/MongoDB Homebrew servislerini başlatır, app ve worker'ı birlikte ayağa kaldırır, formda `Headless` default kapalı gelir.

## Mimari

Proje Laravel benzeri MVC + service/repository/domain ayrımıyla düzenlenmiştir.

- `app.js`: Express uygulamasını kurar; view engine, static dosyalar, route'lar ve middleware burada bağlanır.
- `config/app.js`: Environment değişkenlerini normalize eden merkezi config dosyasıdır.
- `bootstrap/database.js`: MongoDB bağlantısını başlatır.
- `bootstrap/queue.js`: BullMQ queue ve queue event instance'larını başlatır.
- `routes/`: HTTP endpoint'lerini kaynak bazlı router'lara ayırır.
- `app/Http/Controllers/`: Request/response sınırıdır. İş kuralı içermez.
- `app/Http/Middleware/`: Express middleware katmanıdır.
- `views/`: Modüler EJS view katmanıdır. Layout, partial, page ve component olarak ayrılır.
- `public/`: Browser tarafı JavaScript ve CSS dosyalarıdır.
- `app/Models/`: Mongoose model katmanıdır.
- `app/Validators/`: Gelen payload'ı doğrular ve normalize eder.
- `app/Domain/`: Saf domain kararlarını tutar. Run planlama ve final status hesabı burada yapılır.
- `app/Services/`: Use-case katmanıdır. Task create/list/delete, queue publish, worker orchestration, run execution, cancellation, realtime event ve logging burada yönetilir.
- `app/Services/realtimeEventService.js`: Redis pub/sub tabanlı canlı event yayınlama sınırıdır.
- `app/Repositories/`: MongoDB erişimini soyutlar.
- `app/Automation/`: CloakBrowser, cookie uygulama ve Google arama/click otomasyonu burada izole edilir.
- `app/Utils/`: Ortak yardımcılar, domain eşleştirme ve HTTP error sınıflarıdır.

## SOLID Kuralı

Bu projede yeni kodlar SOLID prensiplerine uygun yazılır:

- Controller sadece HTTP sınırını yönetir; iş kuralı service/domain katmanına gider.
- Model sadece veri şeklini ve kalıcılık şemasını taşır.
- View sadece render sorumluluğundadır; business logic içermez.
- Service tek bir use-case'i yönetir.
- Repository veri erişimini dışarı soyutlar.
- Domain modülleri framework bağımsız ve test edilebilir kalır.
- Browser sağlayıcısı `app/Automation/cloakBrowserClient.js` sınırında kalır.
- Queue sağlayıcısı `app/Services/taskJobService.js` sınırında kalır.
- Yeni aksiyon eklenirse log event'i de eklenir.

Bu kurallar `AGENTS.md`, `CODEX.md` ve `CLAUDE.md` içinde de proje kuralı olarak yazılıdır.

## UI Davranışı

- UI `views/` altında EJS ile server-render edilir.
- Browser tarafı state ve event tüketimi `public/app.js` içinde kalır.
- Task ekranı sayfa yenilemeden çalışır. İlk açılışta snapshot alınır, sonra `/api/events` SSE stream'i ile güncellenir.
- Task listesi 10'lu sayfalıdır. Yeni event geldiğinde mevcut task sayfası korunur.
- Her task kartının run listesi de 10'lu sayfalıdır. Run sayfası task bazında korunur.
- `clicked` dışındaki tamamlanmış başarısız run'larda `Retry` butonu görünür.
- `Retry`, task'ın tamamını yeniden oluşturmaz; sadece ilgili run index'ini tekrar kuyruğa alır.
- `Adresler`, başarısız veya `not_found` run için Google'da görülen aday sonuçları modalda gösterir. Aday boşsa Google'ın SERP yerine `sorry`/captcha/challenge veya hata sayfası döndürmüş olabileceği anlaşılır.
- `Düzenle`, task parametrelerini aynı task ID'si üzerinde değiştirir, mevcut run listesini sıfırlar, bekleyen job'ları temizler ve task'ı yeni parametrelerle yeniden kuyruğa alır.
- `Sil`, task'ı MongoDB'den hard delete eder, bekleyen job'ları kaldırır ve UI'dan anında düşürür.
- Loglar `log.created` SSE event'i ile anlık prepend edilir. Error log gelirse `Hatalar` sekmesi de anlık güncellenir.
- Manuel refresh/polling ana akış değildir.

## Google Auth ve Cookie Üretimi

Google Auth sekmesi, Gmail hesaplarını lokal dosyadan import edip Google login akışıyla cookie üretmek için kullanılır. Bu akış local/visible browser kullanımına göre tasarlanmıştır.

### Hesap Kaydı

Tek hesap elle eklenebilir veya düzenlenebilir. Form alanları:

- `Google email`: Gmail hesabı.
- `Şifre`: Gmail şifresi.
- `2FA secret`: Google Authenticator base32 secret. Boşluklu format desteklenir.
- `Hesap proxy`: Bu hesaba özel opsiyonel proxy. Boş kalabilir.
- `Recovery email`, `Recovery şifre`, `Telefon`, `Not`: Opsiyonel metadata.
- `Durum`: `active` veya `disabled`.

Proxy nullable'dır. Hesapta proxy yoksa ve üretim sırasında global proxy verilmezse login direkt bağlantıyla denenir.

### XLSX/CSV/TSV Import

Google Sheets dosyası local olarak indirilip import edilebilir. Desteklenen formatlar:

- `.xlsx`
- `.xls`
- `.csv`
- `.tsv`
- `.txt`

Beklenen kolon başlıkları:

```text
gmail | şifre/sifre | 2fa
```

Örnek tablo:

```text
gmail                    şifre       2fa
ebrusoylu416@gmail.com   12cca32aa   xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx
```

Kolon eşleştirme case-insensitive yapılır ve Türkçe karakterler normalize edilir. `şifre` ve `sifre` aynı kabul edilir.

Opsiyonel kolonlar:

- `proxy` veya `proxyUrl`
- `recoveryEmail`
- `recoveryPassword`
- `telefon` veya `phone`
- `not`, `note` veya `notes`

Import sırasında ayrıca UI'dan `Tek proxy` veya `Proxy listesi` verilebilir. Proxy seçimi önceliği:

1. Dosya içindeki `proxy` kolonu.
2. UI'daki proxy listesi; hesaplara sırayla dağıtılır.
3. UI'daki tek proxy.
4. Boş proxy.

`Importtan sonra otomatik üret` açılırsa import edilen hesaplar sırayla cookie üretimine alınır. Kapalıysa sadece DB'ye hesap olarak kaydedilir.

### Cookie Üretimi

Her hesap satırındaki `Çerez üret` butonu tek hesap için login akışını başlatır. Üretim seçenekleri:

- `Çerez üretim proxy`: O üretim için geçici proxy. Doluysa hesap proxy'sinin önüne geçer.
- `Ekran`: Desktop veya mobil viewport.
- `Headless`: Açık ise browser görünmez. Manuel doğrulama gereken durumlarda kapalı kullanılmalıdır.

Başarılı üretimde:

- Cookie'ler MongoDB'de cookie havuzuna eklenir.
- JSON dosyası `storage/google-auth-cookies/<email>/` altında oluşturulur.
- Hesap satırında son cookie pool ID'si, dosya adı ve dosya yolu görünür.
- `Dosya indir` butonu tek hesabın son cookie JSON dosyasını indirir.

JSON dosya formatı:

```json
{
  "accountId": "...",
  "email": "user@gmail.com",
  "cookiePoolId": "...",
  "generatedAt": "2026-06-17T17:39:05.963Z",
  "loginUrl": "https://myaccount.google.com/",
  "cookies": []
}
```

### Toplu İndirme ve Silme

Google Auth toolbar aksiyonları:

- `Tüm dosyaları indir`: Son cookie dosyası olan tüm hesapları ZIP olarak indirir.
- `Tümünü sil`: Tüm Google Auth hesap kayıtlarını MongoDB'den siler.

`Tümünü sil`, cookie havuzundaki üretilmiş cookie kayıtlarını veya `storage/google-auth-cookies` altındaki dosyaları silmez. Sadece Google Auth hesap listesini temizler.

Toplu ZIP endpoint'i:

```http
GET /api/google-auth/cookies/download-all
```

Toplu silme endpoint'i:

```http
DELETE /api/google-auth
```

### API Endpointleri

Google Auth route'ları `/api/google-auth` altında çalışır:

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

Önemli event/log isimleri:

- `google_auth_accounts_imported`
- `google_auth_cookie_generation_started`
- `google_auth_email_step_started`
- `google_auth_email_step_completed`
- `google_auth_password_step_started`
- `google_auth_password_step_completed`
- `google_auth_cookies_collected`
- `google_auth_cookie_generation_completed`
- `google_auth_cookie_bundle_created`

## Gereksinimler

- Node.js `>=20`
- Redis
- MongoDB
- CloakBrowser binary'si

CloakBrowser Node paketi ESM olduğu için proje CommonJS kalırken adapter içinde dinamik import kullanılır. CloakBrowser JavaScript tarafında Playwright wrapper döndürür: https://github.com/CloakHQ/CloakBrowser

## Lokal Kurulum

```bash
cp .env.example .env
npm install
npm run browser:install
```

API/UI:

```bash
npm run dev
```

Worker:

```bash
npm run worker
```

Lokal `npm run dev` varsayılan olarak `http://localhost:3000` üzerinde çalışır.

## Local Visible Browser macOS/Linux

Docker'sız, macOS/Linux ortamında browser penceresini görerek test etmek için:

```bash
./start.sh
```

Script davranışı:

- Local Redis portu kapalıysa `brew services start redis` dener.
- Local MongoDB portu kapalıysa `mongodb-community`, `mongodb-community@7.0`, `mongodb-community@6.0` servis adlarını dener.
- `PORT` varsayılanı `3100` olur.
- `HEADLESS_DEFAULT=false` olur; formdaki `Headless` switch'i kapalı gelir.
- `MAX_PARALLEL_BROWSERS=1` olur; görünür browser testinde varsayılan olarak en fazla bir pencere açılır.
- App ve worker aynı terminalden başlar. Ctrl+C veya `killall node` ikisini de kapatır.

Görünür desktop modunda CloakBrowser Chromium `--start-maximized` ile açılır ve viewport gerçek pencere boyutuna bırakılır. Mobil ekran seçilirse pencere `390x844` açılır ve context mobil viewport/touch ayarlarıyla başlar.

Task formundaki `Aynı anda tarayıcı` alanı task bazlı concurrency belirler. UI `/api/system/browser-capacity` üzerinden CPU/RAM'e göre öneri gösterir, fakat gerçek üst sınır her zaman `MAX_PARALLEL_BROWSERS` değeridir. Sunucuda 4 tarayıcı istiyorsan env içinde `MAX_PARALLEL_BROWSERS=4` veya daha yüksek bir değer set edilmelidir.

## Windows Server 2022 Local Run

Windows Server 2022 üzerinde önerilen kurulum Windows service installer akışıdır. Proje klasöründe Administrator PowerShell veya Administrator CMD açıp:

```powershell
.\setup-windows.ps1
```

CMD için:

```bat
setup-windows.cmd
```

Installer davranışı:

- Administrator değilse kendini yükseltilmiş PowerShell olarak tekrar açar.
- `winget`, başarısız olursa Chocolatey ile Node.js LTS, MongoDB 7.0.x, Memurai ve NSSM kurmayı dener.
- Chocolatey gerekiyorsa .NET Framework 4.8'i kontrol eder; eksikse indirip kurar ve reboot sonrası setup'ı tekrar çalıştırmanı ister.
- `npm install` çalıştırır.
- `npm run browser:install` ile CloakBrowser stealth Chromium indirmeyi dener. Sadece `CLOAKBROWSER_BINARY_PATH` elle verilirse lokal binary kullanır.
- CloakBrowser cache'ini service kullanabilsin diye `storage\cloakbrowser` altında tutar.
- `Hitmaker Web` ve `Hitmaker Worker` Windows service'lerini kurar.
- Servisleri otomatik başlatmaya ve reboot sonrası otomatik açılacak şekilde ayarlamaya çalışır.
- Masaüstüne `Hitmaker Panel` kısayolu ekler.
- Loglar `storage\logs\HitmakerWeb.*.log` ve `storage\logs\HitmakerWorker.*.log` dosyalarına yazılır.

Windows service modunda browser'lar background session'da çalışır; bu yüzden tasklarda `Headless` açık bırakılmalıdır. Görünür browser ile manuel test gerekiyorsa service yerine `.\startwindows.ps1` ile terminalden çalıştır.

Servis yönetimi:

```bat
hitmaker-service.cmd status
hitmaker-service.cmd restart
hitmaker-service.cmd stop
hitmaker-service.cmd start
```

Servisleri kaldırmak için:

```bat
uninstall-windows.cmd
```

MongoDB/Redis/Memurai ve proje dosyaları uninstall sırasında silinmez.

Tek seferlik local çalıştırma istersen app ve worker'ı terminalden beraber başlatmak için:

```powershell
.\startwindows.ps1
```

Node paketleri, CloakBrowser Chromium, MongoDB ve Redis/Memurai kurulumu da denensin istersen PowerShell'i Administrator olarak açıp:

```powershell
.\startwindows.ps1 -InstallDependencies
```

Kurulumdan sonra app'i başlatmadan doğrulama yapmak için:

```powershell
.\startwindows.ps1 -VerifyOnly
```

Command Prompt veya çift tıklama için:

```bat
startwindows.cmd
```

Command Prompt ile otomatik kurulum:

```bat
startwindows.cmd -InstallDependencies
```

Command Prompt ile doğrulama:

```bat
startwindows.cmd -VerifyOnly
```

Git Bash/WSL içinden Windows PowerShell'i çağırmak için:

```bash
./startwindows
```

Script davranışı:

- `-InstallDependencies` verilirse `winget`, yoksa Chocolatey ile Node.js LTS, MongoDB 7.0.x ve Memurai Developer kurmayı dener.
- `-VerifyOnly` verilirse app/worker başlatmadan Node, npm, JS syntax, CloakBrowser, Redis/Memurai portu, MongoDB portu ve browser kapasite önerisini kontrol eder.
- `node_modules` yoksa `npm install` çalıştırır.
- `npm run browser:install` ile CloakBrowser stealth Chromium indirmeyi dener. Sadece `CLOAKBROWSER_BINARY_PATH` elle verilirse lokal binary kullanır.
- Redis için `Redis` veya `Memurai` Windows service adlarını başlatmayı dener.
- MongoDB için `MongoDB` Windows service adını başlatmayı dener.
- `PORT` varsayılanı `3100` olur.
- `HEADLESS_DEFAULT=true` olur; Windows Server service/desktop session ayrımı nedeniyle headless varsayılan daha güvenlidir.
- `MAX_PARALLEL_BROWSERS=4`, `REQUEST_BODY_LIMIT=25mb`, `CLOAKBROWSER_AUTO_UPDATE=false` varsayılanları set edilir.
- App ve worker aynı terminalden başlar. Terminal kapanınca process tree kapatılır.

Windows'ta görünür browser istenirse script'i RDP ile açık kullanıcı oturumunda çalıştırıp `HEADLESS_DEFAULT=false` env değeri ver.

## Docker

```bash
docker compose up --build
```

Docker Compose ile UI:

```text
http://localhost:3100
```

Docker Compose servisleri:

- `app`: Express web/API server.
- `worker`: BullMQ worker ve browser automation runner.
- `redis`: Sadece compose network içinde kullanılır.
- `mongo`: Sadece compose network içinde kullanılır.

Docker Compose environment için tek kaynak olarak `.env` dosyasını kullanır ve bu dosyayı `app` ile `worker` servislerine `env_file` üzerinden yükler. Docker Compose ile çalıştırırken `.env` içinde Redis/Mongo hostları container network isimleri olmalıdır:

```text
MONGODB_URI=mongodb://mongo:27017/hitmaker
REDIS_HOST=redis
REDIS_PORT=6379
CLOAKBROWSER_AUTO_UPDATE=false
```

Docker'sız lokal `npm run dev` / `npm run worker` akışında aynı `.env` dosyası kullanılacaksa bu değerler `localhost` olarak değiştirilmelidir. `./start.sh` Docker'sız görünür test için kendi local Redis/Mongo varsayılanlarını set eder.

Dockerfile, Playwright dependency'leri hazır Node imajını kullanır ve build sırasında `npx cloakbrowser install` ile CloakBrowser Chromium binary'sini indirir. `CLOAKBROWSER_AUTO_UPDATE=false` kullanılır; binary kontrolsüz şekilde runtime'da güncellenmez.

## Railway

Railway Dockerfile deploy'unda `docker-compose.yml` kullanılmaz ve `.env` dosyası image içine kopyalanmaz. Bu yüzden Railway akışı tek Docker image içinde çalışacak şekilde hazırlanmıştır: Dockerfile Redis Server ve MongoDB Server kurar, default `CMD` olarak `railway-start.sh` çalışır. Bu script aynı container içinde Redis, MongoDB, Express app ve worker süreçlerini beraber başlatır.

Railway için ayrı Redis/Mongo servisi zorunlu değildir. Varsayılan embedded bağlantılar:

```text
MONGODB_URI=mongodb://127.0.0.1:27017/hitmaker
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

Railway Variables ekranında minimum önerilen değişkenler:

```text
QUEUE_NAME=browser-tasks
HEADLESS_DEFAULT=true
MAX_PARALLEL_BROWSERS=1
CLOAKBROWSER_AUTO_UPDATE=false
AUTH_USERNAME=hitmaker
AUTH_PASSWORD=<strong-password>
AUTH_JWT_SECRET=<long-random-secret>
```

Railway Variables ekranında `MONGODB_URI=mongodb://mongo:27017/hitmaker` veya `REDIS_HOST=redis` kalırsa uygulama Railway runtime'da bunları embedded servisler için `127.0.0.1` olarak normalize eder. Yine de Railway için en temiz ayar bu değişkenleri hiç vermemek veya `127.0.0.1` değerlerini kullanmaktır.

Veri kalıcılığı gerekiyorsa Railway'de container'a volume bağlanmalı ve path `/data` olmalıdır. MongoDB `/data/db`, Redis `/data/redis` altında yazar. Volume yoksa Railway redeploy/restart sonrası embedded Mongo/Redis verileri kaybolabilir.

Dış Redis/Mongo servisleri kullanılacaksa `REDIS_URL`, `REDIS_PRIVATE_URL`, `REDIS_PUBLIC_URL`, `REDISHOST`, `REDISPORT`, `REDISUSER`, `REDISPASSWORD`, `MONGODB_URI`, `MONGO_URL` ve `MONGO_PRIVATE_URL` alias'ları desteklenir.

## Ortam Değişkenleri

- `PORT`: Express portu. Varsayılan `3000`.
- `HEADLESS_DEFAULT`: UI formundaki `Headless` switch varsayılanı. `./start.sh` bunu `false` yapar.
- `MONGODB_URI`: MongoDB bağlantısı.
- `MONGO_URL`, `MONGO_PRIVATE_URL`: Railway gibi platformlarda gelen MongoDB bağlantı alias'ları. `MONGODB_URI` yoksa fallback olarak okunur.
- `REDIS_URL`: Redis bağlantı URL'i. Verilirse host/port/password ayarlarının yerine kullanılır.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis bağlantısı.
- `QUEUE_NAME`: BullMQ queue adı.
- `REQUEST_BODY_LIMIT`: JSON/form payload limiti. Çoklu cookie dosyası upload için varsayılan `25mb`.
- `AUTH_USERNAME`: Panel kullanıcı adı. Varsayılan `hitmaker`.
- `AUTH_PASSWORD`: Panel şifresi. Varsayılan `hitmaker34716`.
- `AUTH_JWT_SECRET`: Panel JWT token imzası için secret.
- `AUTH_JWT_TTL_SECONDS`: Panel JWT token geçerlilik süresi. Varsayılan `43200`.
- `MAX_PARALLEL_BROWSERS`: Aynı job içinde kaç browser context paralel çalışacak.
- `TASK_TIMEOUT_MS`: Sayfa aksiyonları için timeout. Maksimum `60000` ms olarak sınırlandırılır.
- `GOOGLE_MAX_RESULT_PAGES`: Hedef domain bulunana kadar kaç Google sonuç sayfası gezileceği. Varsayılan `10`.
- `GOOGLE_SEARCH_HL`: Google arama arayüz dili. Varsayılan `tr`.
- `GOOGLE_SEARCH_GL`: Google arama ülke hedefi. Varsayılan `tr`.
- `GOOGLE_SEARCH_PWS`: Opsiyonel Google kişiselleştirme parametresi. Varsayılan boştur; depersonalized/rank-tracking arama için `0` verilebilir.
- `GOOGLE_SEARCH_UDM`: Opsiyonel Google sonuç modu. Varsayılan boştur; klasik web/AI'sız sonuçlar için `14` verilebilir.
- `CLOAKBROWSER_GEOIP`: Proxy varsa timezone/locale değerlerini proxy IP'sine göre otomatik çözmeye çalışır.
- `CLOAKBROWSER_LOCALE`: CloakBrowser locale ayarı. Örnek: `tr-TR`.
- `CLOAKBROWSER_TIMEZONE`: CloakBrowser timezone ayarı. Örnek: `Europe/Istanbul`.
- `CLOAKBROWSER_HUMANIZE`: `true` ise CloakBrowser humanize davranış katmanı etkinleşir.
- `CLOAKBROWSER_HUMAN_PRESET`: `default` veya `careful`.
- `CLOAKBROWSER_PERSISTENT_PROFILE`: `true` ise browser incognito/ephemeral context yerine kalıcı profil ile açılır. Varsayılan `false`; her run temiz stealth context ile başlar.
- `CLOAKBROWSER_USER_DATA_DIR`: Kalıcı browser profil dizini. Varsayılan proje içinde `storage/browser-profile`.
- Kalıcı profil açılırsa aynı anda tek browser tarafından kullanılmalıdır; bu mod için `MAX_PARALLEL_BROWSERS=1` önerilir.
- `CLOAKBROWSER_BINARY_PATH`: İndirme yerine lokal binary kullanmak için CloakBrowser env değişkeni.
- `CLOAKBROWSER_CACHE_DIR`: Binary cache dizini.
- `CLOAKBROWSER_AUTO_UPDATE`: CloakBrowser auto-update kontrolü.

## Task Payload

Önerilen payload:

```json
{
  "keywords": "r10",
  "targetAddress": "motomax.com.tr",
  "clickCount": 1,
  "maxAttempts": 3,
  "durationHours": 0,
  "headless": true,
  "deviceMode": "desktop",
  "proxyUrl": "",
  "cookies": ""
}
```

Alanlar:

- `keywords`: Zorunlu. Virgül veya satır satır ayrılmış keyword listesi.
- `targetAddress`: Zorunlu. Domain veya tam URL. Örnek: `motomax.com.tr` veya `https://www.motomax.com.tr/...`.
- `clickCount`: Zorunlu. `1-50` arası toplam click/run sayısı.
- `count`: Eski payload uyumluluğu için kabul edilir; yeni kodda `clickCount` tercih edilir.
- `maxAttempts`: Opsiyonel. Laravel job `tries` benzeri run deneme sayısıdır. `1-10` arası kabul edilir, varsayılan `3`'tür. `tries` alias olarak kabul edilir.
- `durationHours`: Opsiyonel. `0-720` arası saat. `0` ise run'lar hemen başlar.
- `headless`: Boolean. Docker için genellikle `true` kullanılmalıdır.
- `deviceMode`: Opsiyonel. `desktop` veya `mobile`; mobil seçilirse browser mobil viewport ve touch ayarlarıyla açılır.
- `proxyUrl`: Opsiyonel. `http://user:pass@host:port`, `https://host:port`, `socks4://host:port` veya `socks5://host:port`.
- `cookies`: Opsiyonel. Satır satır `name=value`, JSON cookie objesi veya JSON cookie array'i.

`durationHours > 0` olduğunda süre `clickCount` kadar parçaya bölünür. Her click kendi zaman parçası içinde random bir zamana planlanır; mekanik eşit aralık oluşturulmaz.

Her run tek progress birimidir. Ara retry'lar progress'i artırmaz; run ancak `clicked`, final `not_found` veya final `failed` sonucunda tamamlanmış sayılır. Manuel `Retry` aynı run index'ini sıfırlayıp tekrar `maxAttempts` kadar dener.

## API

API endpoint'leri JWT ile korunur. Browser panelinde token HttpOnly cookie olarak saklanır; curl ile çağıracaksan `/login` üzerinden cookie alabilir veya `Authorization: Bearer <token>` header'ı gönderebilirsin.

Task listele:

```bash
curl -sS http://127.0.0.1:3100/api/tasks
```

Task oluştur:

```bash
curl -sS -H "Content-Type: application/json" \
  -d '{"keywords":"r10","targetAddress":"motomax.com.tr","clickCount":1,"maxAttempts":3,"durationHours":0,"headless":true}' \
  http://127.0.0.1:3100/api/tasks
```

Task detay:

```bash
curl -sS http://127.0.0.1:3100/api/tasks/<task-id>
```

Task düzenle ve yeniden başlat:

```bash
curl -sS -X PUT -H "Content-Type: application/json" \
  -d '{"keywords":"r10","targetAddress":"r10sport.com","clickCount":1,"maxAttempts":1,"durationHours":0,"headless":false}' \
  http://127.0.0.1:3100/api/tasks/<task-id>
```

Edit aynı task ID'sini korur, `runVersion` değerini artırır, eski run listesini temizler ve yeni job oluşturur. Aktif browser run'ı eski `runVersion` gördüğünde cancellation path'iyle kapanır.

Task sil/cancel:

```bash
curl -sS -X DELETE http://127.0.0.1:3100/api/tasks/<task-id>
```

Run retry:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/tasks/<task-id>/runs/<run-index>/retry
```

`retry` sadece ilgili run'ı tekrar kuyruğa alır. Task'ın tamamı baştan çalışmaz; sonuç aynı run satırına canlı olarak yansır.

Task status değerleri:

- `queued`: Task oluşturuldu, BullMQ job bekliyor.
- `running`: En az bir run çalışıyor veya retry devam ediyor.
- `completed`: Run'lar tamamlandı; en azından süreç tamamlandı. Run bazında `clicked` veya `not_found` görülebilir.
- `failed`: Sistemsel hata oluştu.
- `cancelled`: Eski task kayıtlarında görülebilir; yeni silme davranışı hard delete'tir.

Run status değerleri:

- `queued`: Run planlandı.
- `running`: Browser akışı çalışıyor.
- `clicked`: Hedef sonuç bulundu ve hedef URL'ye gidildi.
- `not_found`: `maxAttempts` denemesi sonunda Google sonuç sayfalarında hedef bulunamadı.
- `blocked_by_google`: Google SERP yerine `google.com/sorry`/captcha/challenge döndürdü; sonuç sayfası parse edilemedi.
- `failed`: `maxAttempts` denemesi sonunda browser/proxy/network veya beklenmeyen hata oluştu.

Run kayıtlarında ayrıca:

- `attempts`: O run'ın kaç kez denendiği.
- `resultPage`: Hedefin bulunduğu Google sonuç sayfası.
- `resultRank`: Hedefin bulunduğu sayfadaki sonuç sırası.
- `candidates`: Google SERP'te görülen aday adresler. Her aday `pageNumber`, `host`, `path`, `href`, `text` alanlarını taşır. Google `sorry`/captcha sayfası döndürürse liste boş kalabilir.

Loglar:

```bash
curl -sS "http://127.0.0.1:3100/api/logs?limit=50"
```

Hatalar:

```bash
curl -sS http://127.0.0.1:3100/api/errors
```

Health:

```bash
curl -sS http://127.0.0.1:3100/api/health
```

Canlı event stream:

```bash
curl -N http://127.0.0.1:3100/api/events
```

`/api/events`, Server-Sent Events formatında `task.updated`, `task.deleted`, `log.created`, `completed`, `failed`, `progress` ve `heartbeat` eventlerini yayınlar. UI bu stream ile reactive çalışır; polling ana akışta kullanılmaz.

## Google Arama Davranışı

Run akışı:

1. CloakBrowser context oluşturulur.
2. Cookie varsa Playwright context'e domain bazlı uygulanır. Cookie uygulamak için hedef siteye preflight navigation yapılmaz.
3. Google arama URL'sine gidilir.
4. Consent ekranı görünürse kabul edilmeye çalışılır.
5. Sayfadaki sonuç linkleri hedef host/path ile karşılaştırılır.
6. Eşleşme yoksa görülen aday adresler run içine ve loglara yazılır.
7. Sayfa aşağı kaydırılır ve tekrar kontrol edilir.
8. Yine eşleşme yoksa `Next/Sonraki` linki veya `start` query parametresi ile sonraki sonuç sayfasına geçilir.
9. Hedef bulunursa hedef URL'ye gidilir ve run `clicked` olur.
10. Hedef sayfada hemen çıkılmaz; kısa bekleme, parça parça aşağı scroll, ara bekleme ve yukarı scroll akışı uygulanır.
11. Limit dolarsa run `not_found` olur. Deneme sayısı `maxAttempts` altındaysa aynı run otomatik tekrar denenir.

Hedef sadece domain ise subdomain kabul edilir. Örnek: `motomax.com.tr`, `www.motomax.com.tr` ile eşleşir. Hedef tam URL ise path de eşleşmelidir.

Google URL üretimi `app/Automation/googleSearchUrl.js` içindedir. Varsayılan query parametreleri `q=<keyword>&hl=tr&gl=tr` şeklindedir. Pagination sadece URL `start` parametresiyle yapılır: `start=10`, `start=20`, `start=30`. Google'ın farklı "Next/Sonraki" DOM varyasyonları veya arama önerileri query'yi değiştirebildiği için pagination link click kullanılmaz. `num` kullanılmaz. `pws=0` ve `udm=14` sadece env ile özellikle istenirse eklenir.

Kullanıcının kendi Chrome oturumunda görülen SERP ile worker'ın gördüğü SERP farklı olabilir. Worker logunda URL `https://www.google.com/sorry/...` ise Google sonuç sayfası yerine challenge dönmüştür; bu durumda `candidates` boş kalır ve hedef manuel tarayıcıda görünse bile worker tarafında `not_found` oluşabilir.

## Proxy Notları

Proxy payload üzerinden her task'a ayrı verilir. Uygulama proxy formatını doğrular ve CloakBrowser context'e geçirir. Ücretsiz proxy servisleri Google Search için çok sık `ERR_EMPTY_RESPONSE`, timeout veya blok döndürür; bu durumda task `failed` olur ve hata loglanır.

## Loglama

Loglar console'a ve MongoDB `logentries` collection'ına yazılır. UI'daki `Loglar` ve `Hatalar` sekmeleri aynı kaynaktan beslenir.

Log yazıldığında `app/Services/logService.js`, MongoDB kaydından sonra `app/Services/realtimeEventService.js` üzerinden `log.created` event'i yayınlar. Web process `/api/events` SSE stream'i ile bu event'i browser'a iletir.

Önemli event örnekleri:

- `http_request`
- `task_created`
- `task_deleted`
- `task_updated`
- `run_retry_queued`
- `run_retry_finished`
- `task_job_enqueued`
- `task_job_completed`
- `task_job_failed`
- `task_run_started`
- `task_run_auto_retry_queued`
- `browser_context_started`
- `browser_cookies_applied`
- `google_search_navigation_started`
- `google_results_page_check_started`
- `google_results_candidates_seen`
- `google_results_match_found`
- `google_results_match_not_found`
- `google_results_next_clicked`
- `google_results_next_start_param`
- `target_navigation_started`
- `target_human_scroll_started`
- `target_human_scroll_completed`
- `target_navigation_completed`
- `task_run_completed`
- `task_run_failed`
- `worker_boot_failed`

Yeni feature eklenirken kullanıcı aksiyonu, queue aksiyonu, browser aksiyonu ve hata path'i loglanmalıdır.

## Doğrulama

Kod değişikliğinden sonra:

```bash
find . -path './node_modules' -prune -o -path './.git' -prune -o -name '*.js' -print0 | xargs -0 -n 1 node --check
docker compose config --quiet
```

Docker ile çalıştırma:

```bash
docker compose up --build -d --force-recreate
curl -sS http://127.0.0.1:3100/api/health
```

Browser davranışı değiştiyse en az bir gerçek task açılıp `/api/tasks/<id>` ve worker logları kontrol edilmelidir. UI değiştiyse `http://localhost:3100` üzerinde task listesi, run pagination, retry, silme ve log stream davranışı gözle kontrol edilmelidir.
