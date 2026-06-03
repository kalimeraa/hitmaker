# Codex Instructions

Bu projede Codex için geçerli kalıcı kurallar `AGENTS.md` içindedir.

Codex bu repoda çalışırken kullanıcı tekrar söylemese bile aşağıdaki dosyayı esas almalıdır:

- `AGENTS.md`

Özet kural: Her kod Laravel benzeri Model-View-Controller yapısına ve SOLID prensiplerine uygun yazılır. HTTP controller ve middleware dosyaları `app/Http/` altında, modeller `app/Models/` altında, servisler `app/Services/` altında tutulur. View katmanı EJS ile `views/` altında layout, partial, page ve component olarak modüler tutulur. `public/` sadece statik asset içindir.

Tüm önemli task, worker, browser, pagination, proxy, click, hata ve cancellation aksiyonları logger ile kaydedilmelidir.

Google Search URL üretimi ve pagination kuralları `AGENTS.md` içindeki "Google Search URL Kuralları" bölümüne göre uygulanır. Query builder `app/Automation/googleSearchUrl.js` içinde kalmalı; pagination `start=10`, `start=20` şeklinde yapılmalı; `num` kullanılmamalıdır.

UI reactive çalışmalıdır. Task/log/error değişimleri Redis pub/sub ve `/api/events` SSE stream'i ile anlık akmalı; polling veya manuel yenileme ana akış olmamalıdır. Task listesi ve task içindeki run listeleri 10'lu pagination ile gösterilir.

Başarısız run retry işlemi run seviyesinde yapılır; task'ın tamamı yeniden oluşturulmaz.
