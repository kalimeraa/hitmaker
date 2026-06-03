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

async function runGoogleSearchClick({ keyword, targetAddress, headless, proxyUrl, cookies, onEvent = noop, shouldCancel = neverCancelled }) {
  const target = normalizeTarget(targetAddress);
  const context = await launchBrowserContext({ headless, proxyUrl });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(taskTimeoutMs);
    page.setDefaultNavigationTimeout(taskTimeoutMs);

    const searchUrl = buildGoogleSearchUrl(keyword);
    onEvent("browser_context_started", { keyword, targetAddress, target });
    await runCancellable(() => page.goto(`https://${target.host}`, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }).catch(() => {}), shouldCancel);
    await applyCookies(context, cookies, target.host);
    onEvent("google_search_navigation_started", { searchUrl });
    await runCancellable(() => page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }), shouldCancel);
    await acceptConsentIfPresent(page);

    const { matchedUrl, resultPage } = await findResultAcrossPages(page, target, googleMaxResultPages, onEvent);

    if (!matchedUrl || !targetMatchesUrl(matchedUrl, target)) {
      return { status: "not_found", matchedUrl: null, resultPage };
    }

    onEvent("target_navigation_started", { matchedUrl, resultPage });
    await runCancellable(() => page.goto(matchedUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }), shouldCancel);
    await runCancellable(() => page.waitForTimeout(2000), shouldCancel);
    onEvent("target_navigation_completed", { matchedUrl, resultPage, finalUrl: page.url() });
    return { status: "clicked", matchedUrl, resultPage };
  } finally {
    await context.close();
  }
}

module.exports = { runGoogleSearchClick };
