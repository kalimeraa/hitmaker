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

## Local Visible Browser

Docker'sız, browser penceresini görerek test etmek için:

```bash
./start.sh
```

Script davranışı:

- Local Redis portu kapalıysa `brew services start redis` dener.
- Local MongoDB portu kapalıysa `mongodb-community`, `mongodb-community@7.0`, `mongodb-community@6.0` servis adlarını dener.
- `PORT` varsayılanı `3100` olur.
- `HEADLESS_DEFAULT=false` olur; formdaki `Headless` switch'i kapalı gelir.
- `MAX_PARALLEL_BROWSERS=1` olur; görünür browser testinde pencereler üst üste binmez.
- App ve worker aynı terminalden başlar. Ctrl+C veya `killall node` ikisini de kapatır.

Görünür browser modunda CloakBrowser Chromium `--start-maximized` ile açılır ve viewport gerçek pencere boyutuna bırakılır.

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

Dockerfile, Playwright dependency'leri hazır Node imajını kullanır ve build sırasında `npx cloakbrowser install` ile CloakBrowser Chromium binary'sini indirir. `CLOAKBROWSER_AUTO_UPDATE=false` kullanılır; binary kontrolsüz şekilde runtime'da güncellenmez.

## Ortam Değişkenleri

- `PORT`: Express portu. Varsayılan `3000`.
- `HEADLESS_DEFAULT`: UI formundaki `Headless` switch varsayılanı. `./start.sh` bunu `false` yapar.
- `MONGODB_URI`: MongoDB bağlantısı.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis bağlantısı.
- `QUEUE_NAME`: BullMQ queue adı.
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
- `CLOAKBROWSER_PERSISTENT_PROFILE`: `true` ise browser incognito context yerine kalıcı profil ile açılır. Varsayılan `true`.
- `CLOAKBROWSER_USER_DATA_DIR`: Kalıcı browser profil dizini. Varsayılan proje içinde `storage/browser-profile`.
- Kalıcı profil aynı anda tek browser tarafından kullanılmalıdır; normal profil davranışı için `MAX_PARALLEL_BROWSERS=1` önerilir.
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
