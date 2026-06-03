# Hitmaker

Node.js tabanlı Google task runner. Express HTTP katmanı EJS view render eder, API route'ları task oluşturur/siler, BullMQ işleri Redis kuyruğuna alır, worker her run'ı MongoDB'ye kaydeder ve browser otomasyonunu Playwright API'si üzerinden CloakBrowser ile çalıştırır.

## Mevcut Durum

- Runtime: Node.js, Express, EJS, MongoDB, Redis, BullMQ.
- Browser: CloakBrowser paketi üzerinden Playwright uyumlu `BrowserContext`.
- UI: Server-rendered EJS + `public/app.js`.
- Docker UI portu: `http://localhost:3100`.
- Container içi app portu: `3000`.
- Redis ve MongoDB Docker Compose içinde host portu yayınlamaz; başka projelerdeki Redis/Mongo portlarıyla çakışmaz.
- Task silme desteklenir. Silinen task `cancelled` olur, bekleyen BullMQ job'ları kaldırılır ve aktif run ilk cancellation kontrolünde kapanır.
- Google sonucu ilk sayfada bulunamazsa `GOOGLE_MAX_RESULT_PAGES` kadar sayfa sayfa aranır.
- Tüm önemli aksiyonlar loglanır: request, task create/delete, queue, run start/end/fail, browser navigation, Google page check, match/not_found ve error.

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
- `app/Services/`: Use-case katmanıdır. Task create/list/delete, queue publish, worker orchestration, run execution, cancellation ve logging burada yönetilir.
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
- `MONGODB_URI`: MongoDB bağlantısı.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis bağlantısı.
- `QUEUE_NAME`: BullMQ queue adı.
- `MAX_PARALLEL_BROWSERS`: Aynı job içinde kaç browser context paralel çalışacak.
- `TASK_TIMEOUT_MS`: Sayfa aksiyonları için timeout.
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
- `durationHours`: Opsiyonel. `0-720` arası saat. `0` ise run'lar hemen başlar.
- `headless`: Boolean. Docker için genellikle `true` kullanılmalıdır.
- `proxyUrl`: Opsiyonel. `http://user:pass@host:port`, `https://host:port`, `socks4://host:port` veya `socks5://host:port`.
- `cookies`: Opsiyonel. Satır satır `name=value`, JSON cookie objesi veya JSON cookie array'i.

`durationHours > 0` olduğunda süre `clickCount` kadar parçaya bölünür. Her click kendi zaman parçası içinde random bir zamana planlanır; mekanik eşit aralık oluşturulmaz.

## API

Task listele:

```bash
curl -sS http://127.0.0.1:3100/api/tasks
```

Task oluştur:

```bash
curl -sS -H "Content-Type: application/json" \
  -d '{"keywords":"r10","targetAddress":"motomax.com.tr","clickCount":1,"durationHours":0,"headless":true}' \
  http://127.0.0.1:3100/api/tasks
```

Task detay:

```bash
curl -sS http://127.0.0.1:3100/api/tasks/<task-id>
```

Task sil/cancel:

```bash
curl -sS -X DELETE http://127.0.0.1:3100/api/tasks/<task-id>
```

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

## Google Arama Davranışı

Run akışı:

1. CloakBrowser context oluşturulur.
2. Cookie varsa hedef host için context'e uygulanır.
3. Google arama URL'sine gidilir.
4. Consent ekranı görünürse kabul edilmeye çalışılır.
5. Sayfadaki sonuç linkleri hedef host/path ile karşılaştırılır.
6. Eşleşme yoksa sayfa aşağı kaydırılır ve tekrar kontrol edilir.
7. Yine eşleşme yoksa `Next/Sonraki` linki veya `start` query parametresi ile sonraki sonuç sayfasına geçilir.
8. Hedef bulunursa hedef URL'ye gidilir ve run `clicked` olur.
9. Limit dolarsa run `not_found` olur.

Hedef sadece domain ise subdomain kabul edilir. Örnek: `motomax.com.tr`, `www.motomax.com.tr` ile eşleşir. Hedef tam URL ise path de eşleşmelidir.

Google URL üretimi `app/Automation/googleSearchUrl.js` içindedir. Varsayılan query parametreleri `q=<keyword>&hl=tr&gl=tr` şeklindedir. Pagination `start=10`, `start=20` şeklinde ilerler; `num` kullanılmaz. `pws=0` ve `udm=14` sadece env ile özellikle istenirse eklenir.

## Proxy Notları

Proxy payload üzerinden her task'a ayrı verilir. Uygulama proxy formatını doğrular ve CloakBrowser context'e geçirir. Ücretsiz proxy servisleri Google Search için çok sık `ERR_EMPTY_RESPONSE`, timeout veya blok döndürür; bu durumda task `failed` olur ve hata loglanır.

## Loglama

Loglar console'a ve MongoDB `logentries` collection'ına yazılır. UI'daki `Loglar` ve `Hatalar` sekmeleri aynı kaynaktan beslenir.

Önemli event örnekleri:

- `http_request`
- `task_created`
- `task_cancelled`
- `task_job_enqueued`
- `task_run_started`
- `browser_context_started`
- `google_search_navigation_started`
- `google_results_page_check_started`
- `google_results_candidates_seen`
- `google_results_match_found`
- `google_results_match_not_found`
- `google_results_next_clicked`
- `google_results_next_start_param`
- `target_navigation_started`
- `target_navigation_completed`
- `task_run_completed`
- `task_run_failed`

Yeni feature eklenirken kullanıcı aksiyonu, queue aksiyonu, browser aksiyonu ve hata path'i loglanmalıdır.
