# Hitmaker MR Giris Public API

Postman'a şu iki dosyayı import et:

- `Hitmaker-MR-Giris-Public.postman_collection.json`
- `Hitmaker-Local.postman_environment.json`

Environment içinde `baseUrl`, `email`, `password`, `emailCode` ve gerekirse `loginUrl` değerlerini değiştir.

Bu request'lerde Authorization yoktur; JWT veya panel cookie gerektirmez.

## Endpointler

### POST `/api/mr-giris/browsers`

Hazır browser başlatır.

```json
{
  "browserCount": 1,
  "loginUrl": "https://mrking5018.com/auth/login",
  "proxyUrl": ""
}
```

Başarılı cevap `202` döner ve job listesini verir.

### POST `/api/mr-giris/login`

Hazır browser'a kullanıcı adı/şifre gönderir. Hazır browser yoksa yeni warmup job açıp credential bağlar.

```json
{
  "email": "kullanici@example.com",
  "password": "sifre",
  "loginUrl": "https://mrking5018.com/auth/login",
  "proxyUrl": ""
}
```

Başarılı cevap job objesi döner. Postman collection, dönen `id` veya `_id` değerini `jobId` değişkenine yazar.

### POST `/api/mr-giris/email-code`

Email doğrulama kodunu çalışan job'a gönderir.

```json
{
  "jobId": "{{jobId}}",
  "code": "123456"
}
```

`jobId` bilinmiyorsa email ile de gönderilebilir:

```json
{
  "email": "kullanici@example.com",
  "code": "123456"
}
```

Çalışan job bulunamazsa `404`, job running değilse `409`, kod eksikse `422` döner.
