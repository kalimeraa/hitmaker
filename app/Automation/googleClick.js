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

async function runGoogleSearchClick({ keyword, targetAddress, headless, proxyUrl, cookies, onEvent = noop, shouldCancel = neverCancelled }) {
  const target = normalizeTarget(targetAddress);
  const context = await launchBrowserContext({ headless, proxyUrl });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(taskTimeoutMs);
    page.setDefaultNavigationTimeout(taskTimeoutMs);

    const searchUrl = buildGoogleSearchUrl(keyword);
    await onEvent("browser_context_started", { keyword, targetAddress, target });
    await applyCookies(context, cookies, target.host);
    if ((cookies || []).length) {
      await onEvent("browser_cookies_applied", { cookieCount: cookies.length, targetHost: target.host });
    }
    await onEvent("google_search_navigation_started", { searchUrl });
    await runCancellable(() => page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }), shouldCancel);
    await acceptConsentIfPresent(page);

    const { matchedUrl, resultPage, resultRank, blockedByGoogle } = await findResultAcrossPages(page, target, googleMaxResultPages, onEvent);

    if (blockedByGoogle) {
      return { status: "blocked_by_google", matchedUrl: null, resultPage, googleBlocked: true };
    }

    if (!matchedUrl || !targetMatchesUrl(matchedUrl, target)) {
      return { status: "not_found", matchedUrl: null, resultPage };
    }

    await onEvent("target_navigation_started", { matchedUrl, resultPage, resultRank });
    await runCancellable(() => page.goto(matchedUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }), shouldCancel);
    await runCancellable(() => page.waitForTimeout(2000), shouldCancel);
    await scrollTargetPageLikeHuman(page, onEvent, shouldCancel);
    await onEvent("target_navigation_completed", { matchedUrl, resultPage, resultRank, finalUrl: page.url() });
    return { status: "clicked", matchedUrl, resultPage, resultRank };
  } finally {
    await context.close();
  }
}

module.exports = { runGoogleSearchClick };
