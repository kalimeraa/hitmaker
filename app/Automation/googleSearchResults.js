async function findResultLink(page, target) {
  return page.evaluate((searchTarget) => {
    function normalizePath(pathname) {
      const decoded = decodeURIComponent(String(pathname || "/"));
      const withoutTrailingSlash = decoded.replace(/\/+$/, "");
      return (withoutTrailingSlash || "/").toLowerCase();
    }

    function resolveResultHref(href) {
      try {
        const parsed = new URL(href);
        const normalizedHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
        if (!normalizedHost.includes("google.")) return href;

        const urlParam = parsed.searchParams.get("url") || parsed.searchParams.get("q");
        if (urlParam && /^https?:\/\//i.test(urlParam)) {
          return urlParam;
        }

        return null;
      } catch (error) {
        return null;
      }
    }

    const links = Array.from(document.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = link.href;
      if (!href || href.includes("/search?")) continue;

      try {
        const resolvedHref = resolveResultHref(href);
        if (!resolvedHref) continue;

        const parsed = new URL(resolvedHref);
        const normalizedHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
        const hostMatches = normalizedHost === searchTarget.host || normalizedHost.endsWith(`.${searchTarget.host}`);
        const pathMatches = !searchTarget.hasPath || normalizePath(parsed.pathname) === searchTarget.path;
        if (hostMatches && pathMatches) {
          link.scrollIntoView({ block: "center", inline: "center" });
          return resolvedHref;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }, target);
}

async function collectResultCandidates(page, limit = 12) {
  return page.evaluate((candidateLimit) => {
    function resolveResultHref(href) {
      try {
        const parsed = new URL(href);
        const normalizedHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
        if (!normalizedHost.includes("google.")) return href;

        const urlParam = parsed.searchParams.get("url") || parsed.searchParams.get("q");
        if (urlParam && /^https?:\/\//i.test(urlParam)) {
          return urlParam;
        }

        return null;
      } catch (error) {
        return null;
      }
    }

    const seen = new Set();
    const candidates = [];
    const links = Array.from(document.querySelectorAll("a[href]"));

    for (const link of links) {
      if (candidates.length >= candidateLimit) break;
      if (!link.href || link.href.includes("/search?")) continue;

      const resolvedHref = resolveResultHref(link.href);
      if (!resolvedHref || seen.has(resolvedHref)) continue;

      try {
        const parsed = new URL(resolvedHref);
        const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
        if (host.includes("google.")) continue;

        seen.add(resolvedHref);
        candidates.push({
          host,
          path: parsed.pathname,
          href: resolvedHref,
          text: String(link.innerText || link.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160)
        });
      } catch (error) {
        continue;
      }
    }

    return candidates;
  }, limit);
}

async function findResultLinkAfterScroll(page, target) {
  let matchedUrl = await retryOnDestroyedContext(() => findResultLink(page, target));
  if (matchedUrl) return matchedUrl;

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  return retryOnDestroyedContext(() => findResultLink(page, target));
}

async function retryOnDestroyedContext(action) {
  try {
    return await action();
  } catch (error) {
    if (!String(error.message || "").includes("Execution context was destroyed")) {
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    return action();
  }
}

async function goToNextResultPage(page, onEvent) {
  const nextLocators = [
    page.locator("a#pnnext").first(),
    page.getByRole("link", { name: /^(next|sonraki)$/i }).first()
  ];

  for (const locator of nextLocators) {
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
      onEvent("google_results_next_clicked", { url: page.url() });
      const previousUrl = page.url();
      await locator.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForFunction((url) => window.location.href !== url, previousUrl, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      return true;
    }
  }

  return goToNextResultPageByStartParam(page, onEvent);
}

async function goToNextResultPageByStartParam(page, onEvent) {
  const currentUrl = page.url();

  try {
    const parsed = new URL(currentUrl);
    if (!parsed.hostname.includes("google.") || !parsed.pathname.includes("/search")) {
      return false;
    }

    const currentStart = Number(parsed.searchParams.get("start") || 0);
    parsed.searchParams.set("start", String(currentStart + 10));
    onEvent("google_results_next_start_param", {
      fromStart: currentStart,
      toStart: currentStart + 10,
      url: parsed.toString()
    });
    await page.goto(parsed.toString(), { waitUntil: "domcontentloaded" });
    return true;
  } catch (error) {
    return false;
  }
}

function noop() {}

async function findResultAcrossPages(page, target, maxPages, onEvent = noop) {
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    onEvent("google_results_page_check_started", {
      pageNumber,
      url: page.url(),
      targetHost: target.host,
      targetPath: target.path
    });

    const matchedUrl = await findResultLinkAfterScroll(page, target);
    if (matchedUrl) {
      onEvent("google_results_match_found", { pageNumber, matchedUrl });
      return { matchedUrl, resultPage: pageNumber };
    }

    const candidates = await retryOnDestroyedContext(() => collectResultCandidates(page));
    onEvent("google_results_candidates_seen", { pageNumber, candidates });
    onEvent("google_results_match_not_found", { pageNumber });

    if (pageNumber === maxPages || !(await goToNextResultPage(page, onEvent))) {
      return { matchedUrl: null, resultPage: pageNumber };
    }
  }

  return { matchedUrl: null, resultPage: maxPages };
}

module.exports = {
  findResultAcrossPages
};
