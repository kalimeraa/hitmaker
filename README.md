# Hitmaker

Node.js tabanlı task runner. Express API task oluşturur, BullMQ işi Redis kuyruğuna alır, worker her koşuyu MongoDB'ye kaydeder ve browser otomasyonunu Playwright API'si üzerinden CloakBrowser ile çalıştırır.

## Mimari

- `app.js` Express uygulamasını kurar; statik UI, `/api` route'ları ve hata middleware'i burada bağlanır.
- `routes/` HTTP endpoint'lerini kaynak bazlı router'lara ayırır: task, log, error ve system route'ları.
- `controllers/` request/response sınırıdır; iş kuralı içermez.
- `validators/` gelen task payload'ını normalize eder: keyword, hedef domain, proxy ve cookie formatı.
- `domain/` saf domain kararlarını tutar; run planlama ve final status hesabı burada yapılır.
- `services/taskService.js` task oluşturma/listeleme use-case'lerini yönetir.
- `services/taskJobService.js` task'ı BullMQ kuyruğuna yayınlar.
- `services/taskProcessorService.js` BullMQ job orchestration katmanıdır.
- `services/taskRunService.js` tek bir browser run'ının durum geçişlerini ve otomasyon çağrısını yönetir.
- `repositories/` MongoDB erişimini soyutlar.
- `automation/cloakBrowserClient.js` CloakBrowser + Playwright context oluşturma sorumluluğunu taşır.
- `automation/browserCookies.js` uygulama cookie modelini Playwright cookie formatına çevirir.
- `automation/googleClick.js` sadece Google araması, sonuç bulma ve hedefe gitme akışını yönetir.
- `services/logService.js` Winston ile console ve MongoDB `logentries` collection'ına log yazar.

Bu ayrımda controller HTTP, service use-case, repository veri erişimi, domain saf karar ve automation browser detayı taşır. Browser sağlayıcısı değişirse ana değişiklik `automation/cloakBrowserClient.js` içinde kalmalıdır; queue sağlayıcısı değişirse `services/taskJobService.js` sınırında kalmalıdır.

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
