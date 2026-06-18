const { Solver } = require("@2captcha/captcha-solver");

// 2captcha API anahtarı çağrı bazlı (UI'dan) gelir; .env'den okunmaz.
// Bu servis saf API entegrasyonudur — Playwright/DOM bilgisi içermez, hem Google Auth hem Task
// akışları tarafından kullanılır.
const POLLING_INTERVAL_MS = 5000;
// Google's enterprise signin captcha can take 2-4 minutes on 2captcha's side, so allow generous time.
const DEFAULT_SOLVE_TIMEOUT_MS = 290000;

const solverCache = new Map();

function normalizeApiKey(apiKey) {
  return String(apiKey || "").trim();
}

function hasApiKey(apiKey) {
  return Boolean(normalizeApiKey(apiKey));
}

function getSolver(apiKey) {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    return null;
  }
  if (!solverCache.has(key)) {
    solverCache.set(key, new Solver(key, POLLING_INTERVAL_MS));
  }
  return solverCache.get(key);
}

/**
 * Solves a reCAPTCHA (v2 / enterprise / invisible) and returns the token.
 * Never throws — returns { success, token, captchaId, error, skipped }.
 */
async function solveRecaptcha({
  apiKey,
  pageurl,
  sitekey,
  enterprise = false,
  invisible = false,
  datas = "",
  action = "",
  proxy = "",
  proxytype = "",
  userAgent = "",
  cookies = "",
  timeoutMs = DEFAULT_SOLVE_TIMEOUT_MS
} = {}) {
  const solver = getSolver(apiKey);
  if (!solver) {
    return { success: false, error: "captcha_api_key_missing", skipped: true };
  }
  if (!sitekey) {
    return { success: false, error: "recaptcha_sitekey_missing" };
  }
  if (!pageurl) {
    return { success: false, error: "recaptcha_pageurl_missing" };
  }

  const request = {
    pageurl,
    googlekey: sitekey,
    enterprise: enterprise ? 1 : 0,
    invisible: invisible ? 1 : 0
  };
  if (datas) request.datas = datas;
  if (action) request.action = action;
  // Google's signin reCAPTCHA token is bound to the solving IP. If 2captcha solves from its own
  // datacenter IP while we submit from our mobile proxy, Google rejects the token. So we hand 2captcha
  // OUR proxy (it solves through the same exit IP) + matching userAgent/cookies for IP & fingerprint
  // alignment. See https://2captcha.com/blog/bypassing-recaptcha-v2-on-google-search
  if (proxy) {
    request.proxy = proxy;
    request.proxytype = (proxytype || "HTTP").toUpperCase();
  }
  if (userAgent) request.userAgent = userAgent;
  if (cookies) request.cookies = cookies;

  const deadline = Date.now() + timeoutMs;
  let lastError = "captcha_solve_failed";

  // 2captrcha'ya giden ağ geçici koparsa (DNS/bağlantı) anında pes etme; süre dolana dek tekrar dene.
  while (Date.now() < deadline) {
    try {
      const remaining = deadline - Date.now();
      const answer = await Promise.race([
        solver.recaptcha(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error("captcha_solve_timeout")), remaining))
      ]);
      const token = answer && answer.data;
      if (!token) {
        return { success: false, error: "captcha_token_empty" };
      }
      return { success: true, token, captchaId: answer.id ? String(answer.id) : "" };
    } catch (error) {
      lastError = error.message || "captcha_solve_failed";
      if (!isTransientNetworkError(lastError) || Date.now() >= deadline) {
        return { success: false, error: lastError };
      }
      await sleep(5000);
    }
  }

  return { success: false, error: lastError };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(message) {
  return /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|failed, reason/i.test(String(message || ""));
}

/** Returns the 2captcha account balance for a key. Never throws. */
async function getBalance(apiKey) {
  const solver = getSolver(apiKey);
  if (!solver) {
    return { success: false, error: "captcha_api_key_missing" };
  }
  try {
    const balance = await solver.balance();
    return { success: true, balance };
  } catch (error) {
    return { success: false, error: error.message || "captcha_balance_failed" };
  }
}

module.exports = {
  hasApiKey,
  solveRecaptcha,
  getBalance,
  DEFAULT_SOLVE_TIMEOUT_MS
};
