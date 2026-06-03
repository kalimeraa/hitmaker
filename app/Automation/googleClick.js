const { googleMaxResultPages, taskTimeoutMs } = require("../../config/app");
const { applyCookies } = require("./browserCookies");
const { launchBrowserContext } = require("./cloakBrowserClient");
const { findResultAcrossPages } = require("./googleSearchResults");
const { normalizeHost, hostnameMatches } = require("../Utils/domain");

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

async function runGoogleSearchClick({ keyword, targetAddress, headless, proxyUrl, cookies }) {
  const targetHost = normalizeHost(targetAddress);
  const context = await launchBrowserContext({ headless, proxyUrl });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(taskTimeoutMs);
    page.setDefaultNavigationTimeout(taskTimeoutMs);

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;
    await page.goto(`https://${targetHost}`, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }).catch(() => {});
    await applyCookies(context, cookies, targetHost);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs });
    await acceptConsentIfPresent(page);

    const { matchedUrl, resultPage } = await findResultAcrossPages(page, targetHost, googleMaxResultPages);

    if (!matchedUrl || !hostnameMatches(matchedUrl, targetHost)) {
      return { status: "not_found", matchedUrl: null, resultPage };
    }

    await page.goto(matchedUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs });
    await page.waitForTimeout(2000);
    return { status: "clicked", matchedUrl, resultPage };
  } finally {
    await context.close();
  }
}

module.exports = { runGoogleSearchClick };
