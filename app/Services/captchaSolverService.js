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

  // Google signin reCAPTCHA = Enterprise; doğru çözüm için data-s `enterprisePayload.s` içinde
  // gönderilmeli (legacy `datas` param'ı enterprise'da yeterli değil). Bu yüzden yeni createTask
  // API'sini kullanıyoruz: RecaptchaV2EnterpriseTask + enterprisePayload + apiDomain + proxy parçaları.
  // Token IP'ye bağlı olduğundan proxy'yi de veriyoruz ki worker bizim exit IP'mizden çözsün.
  const solverProxy = parseSolverProxy(proxy, proxytype);
  const task = {
    type: enterprise
      ? (solverProxy ? "RecaptchaV2EnterpriseTask" : "RecaptchaV2EnterpriseTaskProxyless")
      : (solverProxy ? "RecaptchaV2Task" : "RecaptchaV2TaskProxyless"),
    websiteURL: pageurl,
    websiteKey: sitekey,
    isInvisible: Boolean(invisible),
    apiDomain: "google.com"
  };
  if (enterprise) {
    const payload = {};
    if (datas) payload.s = datas;
    if (action) payload.action = action;
    if (Object.keys(payload).length) task.enterprisePayload = payload;
  } else if (datas) {
    task.recaptchaDataSValue = datas;
  }
  if (userAgent) task.userAgent = userAgent;
  if (cookies) task.cookies = cookies;
  if (solverProxy) Object.assign(task, solverProxy);

  const deadline = Date.now() + timeoutMs;
  let lastError = "captcha_solve_failed";

  // 2captcha'ya giden ağ geçici koparsa (DNS/bağlantı) anında pes etme; süre dolana dek tekrar dene.
  while (Date.now() < deadline) {
    try {
      const result = await runCaptchaTask(apiKey, task, deadline);
      if (result.success) {
        return result;
      }
      lastError = result.error || "captcha_solve_failed";
      if (!isTransientNetworkError(lastError) || Date.now() >= deadline) {
        return result;
      }
      await sleep(5000);
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

// "login:password@host:port" / "host:port" -> 2captcha createTask proxy alanları.
function parseSolverProxy(proxy, proxytype) {
  const text = String(proxy || "").trim();
  if (!text) return null;
  let creds = "";
  let hostport = text;
  if (text.includes("@")) {
    const at = text.lastIndexOf("@");
    creds = text.slice(0, at);
    hostport = text.slice(at + 1);
  }
  const colon = hostport.lastIndexOf(":");
  if (colon === -1) return null;
  const address = hostport.slice(0, colon);
  const port = hostport.slice(colon + 1);
  if (!address || !port) return null;
  const [login, password] = creds ? creds.split(":") : ["", ""];
  const result = {
    proxyType: String(proxytype || "http").toLowerCase(),
    proxyAddress: address,
    proxyPort: Number(port)
  };
  if (login) result.proxyLogin = login;
  if (password) result.proxyPassword = password;
  return result;
}

const CREATE_TASK_URL = "https://api.2captcha.com/createTask";
const GET_TASK_RESULT_URL = "https://api.2captcha.com/getTaskResult";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

// createTask -> getTaskResult polling. Returns { success, token, captchaId } | { success:false, error }.
async function runCaptchaTask(apiKey, task, deadline) {
  const created = await postJson(CREATE_TASK_URL, { clientKey: apiKey, task });
  if (created.errorId) {
    return { success: false, error: created.errorCode || created.errorDescription || "create_task_failed" };
  }
  const taskId = created.taskId;
  if (!taskId) {
    return { success: false, error: "create_task_no_id" };
  }

  while (Date.now() < deadline) {
    await sleep(POLLING_INTERVAL_MS);
    const result = await postJson(GET_TASK_RESULT_URL, { clientKey: apiKey, taskId });
    if (result.errorId) {
      return { success: false, error: result.errorCode || result.errorDescription || "get_task_result_failed" };
    }
    if (result.status === "ready") {
      const token = result.solution && (result.solution.gRecaptchaResponse || result.solution.token);
      if (!token) {
        return { success: false, error: "captcha_token_empty" };
      }
      return { success: true, token, captchaId: String(taskId) };
    }
  }
  return { success: false, error: "captcha_solve_timeout" };
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
