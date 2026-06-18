// Proxy provider soyutlaması (kontrat). Her provider, kendi IP rotasyonunu nasıl yaptığını bilir.
// Mobil proxy'ler (ör. buymobileproxy) IP'yi periyodik döndürür; bu, login ortasında IP'yi
// değiştirip Google'a maksimum bot sinyali verir ve captcha/biometrik challenge tetikler. Çözüm:
// panelde rotasyonu MANUEL'e almak + her hesaptan önce provider üzerinden TEK SEFER taze IP almak.
//
// Kontrat: { name, label, manualReset, async resetIp({ resetUrl, onEvent, settleMs }) -> { success, ... } }
// Yeni bir mobil proxy servisi eklemek için PROVIDERS'a yeni bir giriş eklemek yeterlidir.

const DEFAULT_SETTLE_MS = 12000;
const RESET_REQUEST_TIMEOUT_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

// buymobileproxy: rotasyon panelden "Manuel"e alınır; taze IP, hesap başına reset link'i (api/reset.php)
// çağrılarak alınır. Reset'ten sonra mobil hattın yeni IP'yi kurması için kısa bir bekleme gerekir.
const buyMobileProxyProvider = {
  name: "buymobileproxy",
  label: "Buy Mobile Proxy",
  manualReset: true,
  // Proxy host'unda bu desen geçiyorsa (ör. ankara8.buymobileproxy.com) bu provider otomatik seçilir.
  hostPattern: /buymobileproxy/i,
  async resetIp({ resetUrl, onEvent = async () => {}, settleMs = DEFAULT_SETTLE_MS } = {}) {
    const url = String(resetUrl || "").trim();
    if (!isHttpUrl(url)) {
      return { success: false, error: "proxy_reset_url_missing", skipped: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESET_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = (await response.text().catch(() => "")).trim().slice(0, 200);
      clearTimeout(timer);
      // Yeni mobil IP oturana kadar bekle; aksi halde tarayıcı eski/oturmamış IP ile bağlanır.
      await sleep(settleMs);
      return { success: response.ok, status: response.status, response: body };
    } catch (error) {
      clearTimeout(timer);
      return { success: false, error: error.message || "proxy_reset_failed" };
    }
  }
};

const PROVIDERS = {
  [buyMobileProxyProvider.name]: buyMobileProxyProvider
};

// Provider adından kontratı çözer. Bilinmeyen/boş ad için null döner (reset adımı atlanır).
function resolveProxyProvider(name) {
  const key = String(name || "").trim().toLowerCase();
  return PROVIDERS[key] || null;
}

// Proxy URL'sinin host'undan provider'ı OTOMATİK seçer (ör. ankara8.buymobileproxy.com -> buymobileproxy).
// Eşleşme yoksa null döner; o zaman reset adımı uygulanmaz.
function detectProxyProvider(proxyUrl) {
  const text = String(proxyUrl || "").trim();
  if (!text) return null;
  let host = text;
  try {
    host = new URL(text).hostname || text;
  } catch (error) {
    host = text;
  }
  return Object.values(PROVIDERS).find((provider) => provider.hostPattern && provider.hostPattern.test(host)) || null;
}

function listProxyProviders() {
  return Object.values(PROVIDERS).map((provider) => ({
    name: provider.name,
    label: provider.label,
    manualReset: Boolean(provider.manualReset)
  }));
}

module.exports = {
  resolveProxyProvider,
  detectProxyProvider,
  listProxyProviders
};
