const { taskTimeoutMs } = require("../../config/app");
const { applyCookies } = require("./browserCookies");
const { launchBrowserContext } = require("./cloakBrowserClient");
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

async function findResultLink(page, targetHost) {
  return page.evaluate((host) => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = link.href;
      if (!href || href.includes("/search?") || href.includes("google.")) continue;

      try {
        const parsed = new URL(href);
        const normalizedHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
        if (normalizedHost === host || normalizedHost.endsWith(`.${host}`)) {
          link.scrollIntoView({ block: "center", inline: "center" });
          return href;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }, targetHost);
}

async function runGoogleSearchClick({ keyword, targetAddress, headless, proxyUrl, cookies }) {
  const targetHost = normalizeHost(targetAddress);
  const context = await launchBrowserContext({ headless, proxyUrl });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(taskTimeoutMs);

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;
    await page.goto(`https://${targetHost}`, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }).catch(() => {});
    await applyCookies(context, cookies, targetHost);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs });
    await acceptConsentIfPresent(page);

    let matchedUrl = await findResultLink(page, targetHost);
    if (!matchedUrl) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      matchedUrl = await findResultLink(page, targetHost);
    }

    if (!matchedUrl || !hostnameMatches(matchedUrl, targetHost)) {
      return { status: "not_found", matchedUrl: null };
    }

    await page.goto(matchedUrl, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs });
    await page.waitForTimeout(2000);
    return { status: "clicked", matchedUrl };
  } finally {
    await context.close();
  }
}

module.exports = { runGoogleSearchClick };
