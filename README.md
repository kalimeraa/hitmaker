# Hitmaker

Node.js tabanlı task runner. Express web route'ları EJS view render eder, API route'ları task oluşturur, BullMQ işi Redis kuyruğuna alır, worker her koşuyu MongoDB'ye kaydeder ve browser otomasyonunu Playwright API'si üzerinden CloakBrowser ile çalıştırır.

## Mimari

- `app.js` Express uygulamasını kurar; EJS view engine, static asset servisleri, web route'ları, `/api` route'ları ve hata middleware'i burada bağlanır.
- `config/app.js` environment değişkenlerini normalize eden uygulama config dosyasıdır.
- `bootstrap/database.js` MongoDB bağlantısını, `bootstrap/queue.js` BullMQ queue ve queue event instance'larını başlatır.
- `routes/` HTTP endpoint'lerini kaynak bazlı router'lara ayırır: web, task, log, error ve system route'ları.
- `app/Http/Controllers/` request/response sınırıdır; iş kuralı içermez. API controller'ları JSON döner, web controller'ları view render eder.
- `app/Http/Middleware/` Express middleware katmanıdır.
- `views/` server-rendered EJS view katmanıdır. Layout, partial, page ve component olarak modüler tutulur.
- `app/Models/` Mongoose model katmanıdır.
- `app/Validators/` gelen task payload'ını normalize eder: keyword, hedef domain, proxy ve cookie formatı.
- `app/Domain/` saf domain kararlarını tutar; run planlama ve final status hesabı burada yapılır.
- `app/Services/taskService.js` task oluşturma/listeleme use-case'lerini yönetir.
- `app/Services/taskJobService.js` task'ı BullMQ kuyruğuna yayınlar.
- `app/Services/taskProcessorService.js` BullMQ job orchestration katmanıdır.
- `app/Services/taskRunService.js` tek bir browser run'ının durum geçişlerini ve otomasyon çağrısını yönetir.
- `app/Repositories/` MongoDB erişimini soyutlar.
- `app/Automation/cloakBrowserClient.js` CloakBrowser + Playwright context oluşturma sorumluluğunu taşır.
- `app/Automation/browserCookies.js` uygulama cookie modelini Playwright cookie formatına çevirir.
- `app/Automation/googleClick.js` sadece Google araması, sonuç bulma ve hedefe gitme akışını yönetir.
- `app/Services/logService.js` Winston ile console ve MongoDB `logentries` collection'ına log yazar.

Bu ayrım Laravel benzeri bir MVC düzenidir: `app/Http/Controllers` HTTP sınırını, `app/Models` model katmanını, `views` view katmanını, `app/Services` use-case katmanını, `app/Repositories` veri erişimini, `app/Domain` saf kararları ve `app/Automation` browser detaylarını taşır. Browser sağlayıcısı değişirse ana değişiklik `app/Automation/cloakBrowserClient.js` içinde kalmalıdır; queue sağlayıcısı değişirse `app/Services/taskJobService.js` sınırında kalmalıdır.

## Gereksinimler

- Node.js `>=20`
- Redis
- MongoDB
- CloakBrowser binary'si

CloakBrowser Node paketi ESM olduğu için proje CommonJS kalırken adapter içinde dinamik import kullanılır. Resmi proje dokümanına göre JavaScript tarafında varsayılan import Playwright wrapper'dır ve standart Playwright `Browser` / `BrowserContext` API'si döndürür: https://github.com/CloakHQ/CloakBrowser

## Kurulum

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

UI: http://localhost:3000

## Docker

```bash
docker compose up --build
```

Dockerfile, Node uygulamasını Playwright'ın browser dependency'leri hazır imajı üzerinde çalıştırır ve build sırasında `npx cloakbrowser install` ile CloakBrowser Chromium binary'sini cache'e indirir.

Docker build tüm proje ağacını kopyalar; Laravel benzeri `app/`, `bootstrap/`, `config/`, `routes/`, `views/` ve `public/` klasörleri container içinde aynı path'lerle çalışır.

## Ortam Değişkenleri

- `PORT`: Express portu. Varsayılan `3000`.
- `MONGODB_URI`: MongoDB bağlantısı.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis bağlantısı.
- `QUEUE_NAME`: BullMQ queue adı.
- `MAX_PARALLEL_BROWSERS`: Aynı job içinde kaç browser context paralel çalışacak.
- `TASK_TIMEOUT_MS`: Sayfa aksiyonları için timeout.
- `CLOAKBROWSER_GEOIP`: Proxy varsa timezone/locale değerlerini proxy IP'sine göre otomatik çözmeye çalışır.
- `CLOAKBROWSER_LOCALE`: CloakBrowser locale ayarı. Örnek: `en-US`.
- `CLOAKBROWSER_TIMEZONE`: CloakBrowser timezone ayarı. Örnek: `America/New_York`.
- `CLOAKBROWSER_HUMANIZE`: `true` ise CloakBrowser humanize davranış katmanı etkinleşir.
- `CLOAKBROWSER_HUMAN_PRESET`: `default` veya `careful`.
- `CLOAKBROWSER_BINARY_PATH`: İndirme yerine lokal binary kullanmak için CloakBrowser env değişkeni.
- `CLOAKBROWSER_CACHE_DIR`: Binary cache dizini.
- `CLOAKBROWSER_AUTO_UPDATE`: CloakBrowser auto-update kontrolü.

## Kullanım Notları

- UI'daki `Browser sayısı` toplam kaç run üretileceğini belirler.
- `MAX_PARALLEL_BROWSERS` aynı anda kaç run çalışacağını sınırlar.
- `Headless` kapatılırsa worker browser pencerelerini görünür açmaya çalışır; Docker içinde genellikle headless kullanılmalıdır.
- Hedef site alanına `facebook.com` veya `https://www.facebook.com` formatında değer girilebilir.
- Proxy alanı `http://user:pass@host:port`, `https://host:port`, `socks4://host:port` veya `socks5://host:port` formatlarını kabul eder.
- Cookie alanı satır satır `name=value` veya JSON cookie objesi/array'i kabul eder.
- Sistem hataları UI'daki `Hatalar` sekmesinden veya `GET /api/errors` endpoint'inden izlenir.
- Docker Compose içindeki MongoDB geliştirme kolaylığı için `tmpfs` kullanır; container yeniden yaratılırsa task kayıtları silinir.
