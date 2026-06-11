const { googleMaxResultPages, taskTimeoutMs } = require("../../config/app");
const { applyCookies } = require("./browserCookies");
const { launchBrowserContext } = require("./cloakBrowserClient");
const { findResultAcrossPages } = require("./googleSearchResults");
const { buildGoogleSearchUrl } = require("./googleSearchUrl");
const { normalizeTarget, targetMatchesUrl } = require("../Utils/domain");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function acceptConsentIfPresent(page) {
  const labels = [
    "Accept all",
    "I agree",
    "Tümünü kabul et",
    "Kabul ediyorum"
  ];

  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}$`, "i") }).first();
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click();
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      return;
    }
  }
}

function noop() {}

async function neverCancelled() {
  return false;
}

function isGoogleResponseCodeFailure(error) {
  return String(error && error.message || "").includes("ERR_HTTP_RESPONSE_CODE_FAILURE");
}

function proxyHost(proxyUrl) {
  if (!proxyUrl) return "";

  try {
    return new URL(proxyUrl).host;
  } catch (error) {
    return "";
  }
}

async function runCancellable(action, shouldCancel) {
  let intervalId;
  const cancellation = new Promise((_, reject) => {
    intervalId = setInterval(async () => {
      try {
        if (await shouldCancel()) {
          reject(new Error("Task cancelled"));
        }
      } catch (error) {
        reject(error);
      }
    }, 1000);
  });

  return Promise.race([action(), cancellation]).finally(() => clearInterval(intervalId));
}

async function navigateToTargetWithRetry(page, matchedUrl, onEvent, shouldCancel, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await onEvent("target_navigation_attempt_started", { matchedUrl, attempt, attempts });
      await runCancellable(() => page.goto(matchedUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }), shouldCancel);
      return;
    } catch (error) {
      lastError = error;
      await onEvent("target_navigation_attempt_failed", {
        matchedUrl,
        attempt,
        attempts,
        error: error.message
      });

      if (attempt < attempts) {
        await runCancellable(() => page.waitForTimeout(1200 + Math.floor(Math.random() * 1600)), shouldCancel);
      }
    }
  }

  throw lastError;
}

async function scrollTargetPageLikeHuman(page, onEvent, shouldCancel) {
  await onEvent("target_human_scroll_started", { url: page.url() });
  await runCancellable(() => page.waitForTimeout(1800 + Math.floor(Math.random() * 2200)), shouldCancel);

  const downSteps = 4 + Math.floor(Math.random() * 4);
  for (let index = 0; index < downSteps; index += 1) {
    await runCancellable(() => page.mouse.wheel(0, 360 + Math.floor(Math.random() * 360)), shouldCancel);
    await runCancellable(() => page.waitForTimeout(700 + Math.floor(Math.random() * 1100)), shouldCancel);
  }

  await runCancellable(() => page.waitForTimeout(1600 + Math.floor(Math.random() * 2600)), shouldCancel);

  const upSteps = 2 + Math.floor(Math.random() * 3);
  for (let index = 0; index < upSteps; index += 1) {
    await runCancellable(() => page.mouse.wheel(0, -300 - Math.floor(Math.random() * 260)), shouldCancel);
    await runCancellable(() => page.waitForTimeout(700 + Math.floor(Math.random() * 1000)), shouldCancel);
  }

  await runCancellable(() => page.waitForTimeout(1800 + Math.floor(Math.random() * 2600)), shouldCancel);
  await onEvent("target_human_scroll_completed", { url: page.url() });
}

async function holdVisibleFailurePage(page, headless, onEvent, shouldCancel) {
  if (headless) return;

  await onEvent("visible_failure_hold_started", { url: page.url() });
  await runCancellable(() => page.waitForTimeout(10000), shouldCancel).catch(() => {});
}

async function logProxyExitIp(page, proxyUrl, onEvent, shouldCancel) {
  if (!proxyUrl) return;

  const checkUrl = "https://api.ipify.org?format=json";
  try {
    await onEvent("browser_proxy_exit_ip_check_started", { proxyHost: proxyHost(proxyUrl), checkUrl });
    await runCancellable(() => page.goto(checkUrl, { waitUntil: "domcontentloaded", timeout: 10000 }), shouldCancel);
    const bodyText = await runCancellable(() => page.locator("body").innerText({ timeout: 5000 }), shouldCancel);
    const parsed = JSON.parse(bodyText);
    await onEvent("browser_proxy_exit_ip_checked", {
      proxyHost: proxyHost(proxyUrl),
      exitIp: parsed.ip || "",
      checkUrl
    });
  } catch (error) {
    await onEvent("browser_proxy_exit_ip_check_failed", {
      proxyHost: proxyHost(proxyUrl),
      error: error.message,
      url: page.url()
    });
  }
}

async function runGoogleSearchClick({ keyword, targetAddress, headless, deviceMode = "desktop", proxyUrl, cookies, onEvent = noop, shouldCancel = neverCancelled }) {
  const target = normalizeTarget(targetAddress);
  const context = await launchBrowserContext({ headless, deviceMode, proxyUrl });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(taskTimeoutMs);
    page.setDefaultNavigationTimeout(taskTimeoutMs);

    const searchUrl = buildGoogleSearchUrl(keyword);
    await onEvent("browser_context_started", { keyword, targetAddress, target, deviceMode, hasProxy: Boolean(proxyUrl), proxyHost: proxyHost(proxyUrl) });
    await logProxyExitIp(page, proxyUrl, onEvent, shouldCancel);
    await applyCookies(context, cookies, target.host);
    if ((cookies || []).length) {
      const googleCookies = await context.cookies("https://www.google.com").catch(() => []);
      await onEvent("browser_cookies_applied", {
        cookieCount: cookies.length,
        googleCookieCount: googleCookies.length,
        targetHost: target.host
      });
    }
    await onEvent("google_search_navigation_started", { searchUrl });
    try {
      await runCancellable(() => page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }), shouldCancel);
    } catch (error) {
      await onEvent("google_search_navigation_failed", {
        searchUrl,
        url: page.url(),
        error: error.message,
        googleBlocked: isGoogleResponseCodeFailure(error)
      });
      await holdVisibleFailurePage(page, headless, onEvent, shouldCancel);

      if (isGoogleResponseCodeFailure(error)) {
        return { status: "blocked_by_google", matchedUrl: null, resultPage: null, googleBlocked: true };
      }

      throw error;
    }
    await acceptConsentIfPresent(page);

    const { matchedUrl, resultPage, resultRank, blockedByGoogle } = await findResultAcrossPages(page, target, googleMaxResultPages, onEvent);

    if (blockedByGoogle) {
      return { status: "blocked_by_google", matchedUrl: null, resultPage, googleBlocked: true };
    }

    if (!matchedUrl || !targetMatchesUrl(matchedUrl, target)) {
      return { status: "not_found", matchedUrl: null, resultPage };
    }

    await onEvent("target_navigation_started", { matchedUrl, resultPage, resultRank });
    await navigateToTargetWithRetry(page, matchedUrl, onEvent, shouldCancel);
    await runCancellable(() => page.waitForTimeout(2000), shouldCancel);
    await scrollTargetPageLikeHuman(page, onEvent, shouldCancel);
    await onEvent("target_navigation_completed", { matchedUrl, resultPage, resultRank, finalUrl: page.url() });
    return { status: "clicked", matchedUrl, resultPage, resultRank };
  } finally {
    await context.close();
  }
}

module.exports = { runGoogleSearchClick };
