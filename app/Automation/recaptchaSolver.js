// Browser glue around the pure captcha solver service: extract sitekey from the live page,
// hand it to 2captcha via captchaSolverService, then inject the returned token back into the page.
const captchaSolverService = require("../Services/captchaSolverService");

const { hasApiKey } = captchaSolverService;

// Parses a reCAPTCHA anchor/bframe iframe URL into { sitekey, enterprise, invisible }.
function parseRecaptchaFrameUrl(src) {
  if (!src || !/recaptcha\/(api2|enterprise)\/(anchor|bframe)/.test(src) || !/[?&]k=/.test(src)) {
    return null;
  }
  try {
    const params = new URL(src).searchParams;
    const sitekey = params.get("k");
    if (!sitekey) return null;
    return {
      sitekey,
      enterprise: /\/enterprise\//.test(src),
      invisible: params.get("size") === "invisible",
      // The `s` param on Google service captchas IS the data-s 2captcha needs to solve them.
      datas: params.get("s") || null
    };
  } catch (error) {
    return null;
  }
}

// Reads the reCAPTCHA parameters from the DOM (main frame) so we never hardcode a sitekey.
// Standard sites use `data-sitekey`; Google's own signin challenge uses `data-site-key` /
// `data-enterprise-site-key` (the latter marks reCAPTCHA Enterprise).
async function extractRecaptchaParams(page) {
  return page.evaluate(() => {
    let sitekey = null;
    let datas = null;
    let invisible = false;
    let enterprise = false;

    const widget = document.querySelector("[data-sitekey], [data-site-key], [data-enterprise-site-key]");
    if (widget) {
      const enterpriseKey = widget.getAttribute("data-enterprise-site-key");
      sitekey = widget.getAttribute("data-sitekey")
        || widget.getAttribute("data-site-key")
        || enterpriseKey;
      // Google service captchas expose the required data-s as `data-client-signature`.
      datas = widget.getAttribute("data-s") || widget.getAttribute("data-client-signature");
      invisible = widget.getAttribute("data-size") === "invisible";
      if (enterpriseKey) enterprise = true;
    }

    const iframeSrcs = Array.from(document.querySelectorAll("iframe")).map((iframe) => iframe.getAttribute("src") || "");
    if (iframeSrcs.some((src) => /recaptcha\/enterprise\//.test(src))) enterprise = true;

    return { sitekey, datas: datas || null, invisible, enterprise, iframeSrcs };
  });
}

// Cross-origin reCAPTCHA iframes are reliably visible via Playwright's frame list even when the
// DOM `src` attribute is rewritten — scan both and merge.
async function resolveRecaptchaParams(page) {
  const dom = await extractRecaptchaParams(page).catch(() => null);
  let result = {
    sitekey: dom && dom.sitekey ? dom.sitekey : null,
    datas: dom ? dom.datas : null,
    invisible: Boolean(dom && dom.invisible),
    enterprise: Boolean(dom && dom.enterprise)
  };

  const frameSources = [
    ...((dom && dom.iframeSrcs) || []),
    ...page.frames().map((frame) => frame.url())
  ];

  for (const src of frameSources) {
    const parsed = parseRecaptchaFrameUrl(src);
    if (parsed) {
      if (!result.sitekey) result.sitekey = parsed.sitekey;
      if (parsed.enterprise) result.enterprise = true;
      if (parsed.invisible) result.invisible = true;
      // The anchor iframe's live `s` param is the freshest data-s; prefer it.
      if (parsed.datas) result.datas = parsed.datas;
      break;
    }
  }

  return result;
}

// Writes the solved token back into the page. Google's signin page reads the token via
// grecaptcha.enterprise.getResponse() (internal state), NOT the textarea — so we both fill the
// textarea AND override getResponse() to return our token, then fire reCAPTCHA's success callback.
async function injectRecaptchaToken(page, token) {
  return page.evaluate((solvedToken) => {
    let textareaCount = 0;
    // NOTE: Google's signin page enforces Trusted Types, so NEVER touch innerHTML here — assigning
    // it throws and aborts the whole injection. Setting .value / .textContent is safe and is what
    // reCAPTCHA actually reads. Each step is isolated so one failure can't kill the override/callback.
    try {
      const textareas = Array.from(document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea#g-recaptcha-response, textarea[id^="g-recaptcha-response"]'));
      if (!textareas.length) {
        const created = document.createElement("textarea");
        created.name = "g-recaptcha-response";
        created.id = "g-recaptcha-response";
        created.style.display = "block";
        document.body.appendChild(created);
        textareas.push(created);
      }
      for (const textarea of textareas) {
        textarea.value = solvedToken;
        textarea.textContent = solvedToken;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        textareaCount += 1;
      }
    } catch (textareaError) {
      /* textarea fill is best-effort; keep going to override + callback */
    }

    // Force grecaptcha.getResponse() (v2 + enterprise) to return our token — this is what
    // Google's client JS checks when "Next" is clicked.
    let getResponseOverridden = false;
    try {
      const override = (api) => {
        if (api && typeof api === "object") {
          api.getResponse = () => solvedToken;
          getResponseOverridden = true;
        }
      };
      if (window.grecaptcha) {
        override(window.grecaptcha);
        override(window.grecaptcha.enterprise);
      }
    } catch (error) {
      /* override is best-effort */
    }

    // Invoke EVERY success callback reCAPTCHA registered so the host page's handler runs. Google's
    // signin page advances only when this client callback fires with the token — setting the
    // textarea alone is not enough. Walk the whole ___grecaptcha_cfg.clients tree (visited-guarded)
    // and call every function-valued `callback` we find, on both v2 and enterprise configs.
    let callbackInvoked = false;
    try {
      const cfg = window.___grecaptcha_cfg;
      if (cfg && cfg.clients) {
        const seen = new Set();
        const stack = Object.values(cfg.clients);
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== "object" || seen.has(node)) continue;
          seen.add(node);
          for (const value of Object.values(node)) {
            if (value && typeof value === "object") {
              if (typeof value.callback === "function") {
                try { value.callback(solvedToken); callbackInvoked = true; } catch (callbackError) { /* keep scanning */ }
              }
              stack.push(value); // keep traversing even past a callback-bearing node
            } else if (typeof value === "function" && value.length === 1) {
              /* some configs store the bare callback as a 1-arg function */
              // intentionally not auto-invoked: too broad; handled via the .callback path above
            }
          }
        }
      }
    } catch (error) {
      /* callback discovery is best-effort */
    }

    return { textareas: textareaCount, getResponseOverridden, callbackInvoked };
  }, token);
}

// Diagnostic: dumps reCAPTCHA-relevant state for every frame so we can see exactly where Google
// keeps the grecaptcha API and the token field.
async function inspectRecaptchaDom(page) {
  const frames = [];
  for (const frame of page.frames()) {
    const info = await frame.evaluate(() => {
      const textareaList = Array.from(document.querySelectorAll("textarea")).map((t) => ({
        id: t.id || "",
        name: t.getAttribute("name") || ""
      }));
      const hiddenInputs = Array.from(document.querySelectorAll('input[type="hidden"]')).map((i) => i.getAttribute("name") || "").filter(Boolean);
      return {
        hasGrecaptcha: typeof window.grecaptcha !== "undefined",
        hasEnterprise: !!(window.grecaptcha && window.grecaptcha.enterprise),
        hasCfg: typeof window.___grecaptcha_cfg !== "undefined",
        cfgClients: window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients ? Object.keys(window.___grecaptcha_cfg.clients).length : 0,
        textareas: textareaList,
        responseTextareas: textareaList.filter((t) => /g-recaptcha-response/.test(t.id) || /g-recaptcha-response/.test(t.name)).length,
        hiddenInputs: hiddenInputs.slice(0, 30)
      };
    }).catch((error) => ({ error: error.message }));
    frames.push({ url: (frame.url() || "").slice(0, 90), ...info });
  }
  return frames;
}

// The challenge page can reload itself during the (often 60-120s) enterprise solve, leaving the
// document mid-init. Wait until grecaptcha + the response textarea are present again before injecting.
async function waitForRecaptchaReady(page, timeoutMs = 20000) {
  return page.waitForFunction(() => (
    typeof window.grecaptcha !== "undefined"
    && !!document.querySelector('textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"]')
  ), { timeout: timeoutMs }).then(() => true).catch(() => false);
}

function isContextDestroyedError(message) {
  return /execution context was destroyed|context was destroyed|navigation|detached|Target closed|Cannot find context/i.test(String(message || ""));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The enterprise solve takes minutes, during which Google's challenge page reloads itself at least
// once. A single page.evaluate then dies with "execution context was destroyed", so the token never
// lands. Re-sync with the page and retry the injection until it sticks (or attempts run out).
async function injectRecaptchaTokenStable(page, token, { attempts = 4 } = {}) {
  let last = { textareas: 0, getResponseOverridden: false, callbackInvoked: false };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await waitForRecaptchaReady(page);
    try {
      const result = await injectRecaptchaToken(page, token);
      last = result;
      // Success = the token actually reached a textarea AND grecaptcha now returns it.
      if (result && result.textareas > 0 && result.getResponseOverridden) {
        return result;
      }
    } catch (error) {
      last = { textareas: 0, getResponseOverridden: false, callbackInvoked: false, error: error.message };
      if (!isContextDestroyedError(error.message)) {
        // A non-navigation failure won't fix itself by retrying.
        return last;
      }
    }
    // Let the reloading page settle, then try again.
    await sleep(1500);
  }
  return last;
}

/**
 * Detects a reCAPTCHA widget on the current page, solves it via the captcha solver service and
 * injects the token. `apiKey` is supplied per request from the UI. Returns { success, ... }
 * without throwing so callers can fall back to manual handling.
 */
// The challenge page lands on /challenge/recaptcha BEFORE the reCAPTCHA widget (with its
// data-enterprise-site-key) has rendered, so a single immediate read returns no sitekey. Poll until
// the widget appears (or we time out), logging each step so failures are visible in the logs.
async function waitForRecaptchaParams(page, onEvent = async () => {}, { timeoutMs = 25000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let last = null;
  while (Date.now() < deadline && !page.isClosed()) {
    attempt += 1;
    last = await resolveRecaptchaParams(page).catch(() => null);
    if (last && last.sitekey) {
      await onEvent("google_auth_captcha_sitekey_resolved", {
        sitekey: last.sitekey,
        enterprise: Boolean(last.enterprise),
        hasDatas: Boolean(last.datas),
        attempt
      });
      return last;
    }
    await sleep(intervalMs);
  }
  await onEvent("google_auth_captcha_sitekey_wait_timeout", { attempts: attempt });
  return last;
}

// Converts our proxy URL (http://user:pass@host:port / socks5://...) into the { proxy, proxytype }
// pair 2captcha expects (proxy = "login:password@host:port", proxytype = HTTP/HTTPS/SOCKS4/SOCKS5).
// We MUST give 2captcha the same upstream proxy the browser exits through so the solved token's IP
// matches ours — otherwise Google rejects it server-side.
function proxyUrlToSolverProxy(proxyUrl) {
  const text = String(proxyUrl || "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const scheme = parsed.protocol.replace(":", "").toLowerCase();
    const proxytype = scheme.startsWith("socks5") ? "SOCKS5"
      : scheme.startsWith("socks4") ? "SOCKS4"
      : scheme === "https" ? "HTTPS"
      : "HTTP";
    const host = parsed.hostname;
    const port = parsed.port;
    if (!host || !port) return null;
    const login = decodeURIComponent(parsed.username || "");
    const password = decodeURIComponent(parsed.password || "");
    const auth = login ? `${login}${password ? `:${password}` : ""}@` : "";
    return { proxy: `${auth}${host}:${port}`, proxytype };
  } catch (error) {
    return null;
  }
}

// 2captcha wants cookies as a `name:value;name2:value2` string for the worker session.
async function collectCookieString(page) {
  try {
    const cookies = await page.context().cookies();
    return cookies
      .filter((cookie) => cookie && cookie.name)
      .map((cookie) => `${cookie.name}:${cookie.value}`)
      .join(";");
  } catch (error) {
    return "";
  }
}

async function solveRecaptchaOnPage(page, { apiKey, onEvent = async () => {}, debug = process.env.CAPTCHA_DEBUG === "1", proxyUrl = "" } = {}) {
  if (!hasApiKey(apiKey)) {
    return { success: false, error: "captcha_api_key_missing", skipped: true };
  }

  // Wait for the sitekey widget to actually render before handing off to 2captcha.
  const params = await waitForRecaptchaParams(page, onEvent);
  if (!params || !params.sitekey) {
    return { success: false, error: "recaptcha_sitekey_not_found" };
  }

  // Hand 2captcha our proxy + browser fingerprint so the token is solved from the same IP we submit
  // from (the root cause of Google rejecting otherwise-valid tokens on its signin page).
  const solverProxy = proxyUrlToSolverProxy(proxyUrl);
  const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => "");
  const cookies = await collectCookieString(page);

  await onEvent("google_auth_captcha_solve_started", {
    sitekey: params.sitekey,
    enterprise: Boolean(params.enterprise),
    invisible: Boolean(params.invisible),
    provider: "2captcha",
    viaProxy: Boolean(solverProxy),
    proxytype: solverProxy ? solverProxy.proxytype : "",
    hasUserAgent: Boolean(userAgent),
    hasCookies: Boolean(cookies)
  });

  if (debug) {
    const dom = await inspectRecaptchaDom(page).catch((error) => [{ error: error.message }]);
    await onEvent("google_auth_captcha_dom_inspected", { frames: dom });
  }

  const solve = await captchaSolverService.solveRecaptcha({
    apiKey,
    pageurl: page.url(),
    sitekey: params.sitekey,
    enterprise: params.enterprise,
    invisible: params.invisible,
    datas: params.datas || "",
    proxy: solverProxy ? solverProxy.proxy : "",
    proxytype: solverProxy ? solverProxy.proxytype : "",
    userAgent,
    cookies
  });

  if (!solve.success) {
    await onEvent("google_auth_captcha_solve_failed", { error: solve.error });
    return { success: false, error: solve.error, skipped: solve.skipped };
  }

  // Re-sync with the (possibly reloaded) page before injecting the token, retrying through the
  // navigation races the long enterprise solve triggers.
  const ready = await waitForRecaptchaReady(page);
  const injection = await injectRecaptchaTokenStable(page, solve.token).catch((error) => ({ error: error.message }));
  await onEvent("google_auth_captcha_solved", {
    captchaId: solve.captchaId,
    tokenLength: solve.token.length,
    recaptchaReady: ready,
    injectedInto: injection && injection.textareas ? injection.textareas : 0,
    getResponseOverridden: Boolean(injection && injection.getResponseOverridden),
    callbackInvoked: Boolean(injection && injection.callbackInvoked),
    injectionError: injection && injection.error ? injection.error : ""
  });

  return { success: true, token: solve.token, captchaId: solve.captchaId };
}

module.exports = {
  hasApiKey,
  parseRecaptchaFrameUrl,
  extractRecaptchaParams,
  resolveRecaptchaParams,
  injectRecaptchaToken,
  injectRecaptchaTokenStable,
  solveRecaptchaOnPage
};
