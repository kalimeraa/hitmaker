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

async function findResultLinkAfterScroll(page, targetHost) {
  let matchedUrl = await findResultLink(page, targetHost);
  if (matchedUrl) return matchedUrl;

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  return findResultLink(page, targetHost);
}

async function goToNextResultPage(page) {
  const nextLocators = [
    page.locator("a#pnnext").first(),
    page.getByRole("link", { name: /^(next|sonraki)$/i }).first()
  ];

  for (const locator of nextLocators) {
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
      await locator.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return true;
    }
  }

  return goToNextResultPageByStartParam(page);
}

async function goToNextResultPageByStartParam(page) {
  const currentUrl = page.url();

  try {
    const parsed = new URL(currentUrl);
    if (!parsed.hostname.includes("google.") || !parsed.pathname.includes("/search")) {
      return false;
    }

    const currentStart = Number(parsed.searchParams.get("start") || 0);
    parsed.searchParams.set("start", String(currentStart + 10));
    await page.goto(parsed.toString(), { waitUntil: "domcontentloaded" });
    return true;
  } catch (error) {
    return false;
  }
}

async function findResultAcrossPages(page, targetHost, maxPages) {
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const matchedUrl = await findResultLinkAfterScroll(page, targetHost);
    if (matchedUrl) {
      return { matchedUrl, resultPage: pageNumber };
    }

    if (pageNumber === maxPages || !(await goToNextResultPage(page))) {
      return { matchedUrl: null, resultPage: pageNumber };
    }
  }

  return { matchedUrl: null, resultPage: maxPages };
}

module.exports = {
  findResultAcrossPages
};
