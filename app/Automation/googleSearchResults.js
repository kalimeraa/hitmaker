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
    let rank = 0;
    for (const link of links) {
      const href = link.href;
      if (!href || href.includes("/search?")) continue;

      try {
        const resolvedHref = resolveResultHref(href);
        if (!resolvedHref) continue;

        const parsed = new URL(resolvedHref);
        const normalizedHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
        if (normalizedHost.includes("google.")) continue;
        rank += 1;
        const hostMatches = normalizedHost === searchTarget.host || normalizedHost.endsWith(`.${searchTarget.host}`);
        const pathMatches = !searchTarget.hasPath || normalizePath(parsed.pathname) === searchTarget.path;
        if (hostMatches && pathMatches) {
          link.scrollIntoView({ block: "center", inline: "center" });
          return { href: resolvedHref, rank };
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
          rank: candidates.length + 1,
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
  let match = await retryOnDestroyedContext(() => findResultLink(page, target));
  if (match) return match;

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

function isGoogleChallengeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("google.") && (
      parsed.pathname.includes("/sorry") ||
      parsed.pathname.includes("/sorry/") ||
      parsed.searchParams.has("captcha")
    );
  } catch (error) {
    return false;
  }
}

async function goToNextResultPage(page, onEvent) {
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
    await onEvent("google_results_next_start_param", {
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

async function noop() {}

async function findResultAcrossPages(page, target, maxPages, onEvent = noop) {
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    await onEvent("google_results_page_check_started", {
      pageNumber,
      url: page.url(),
      targetHost: target.host,
      targetPath: target.path
    });

    if (isGoogleChallengeUrl(page.url())) {
      await onEvent("google_results_blocked_by_google", { pageNumber, url: page.url() });
      await onEvent("google_results_candidates_seen", { pageNumber, candidates: [] });
      return { matchedUrl: null, resultPage: pageNumber, blockedByGoogle: true };
    }

    const match = await findResultLinkAfterScroll(page, target);
    if (match) {
      await onEvent("google_results_match_found", { pageNumber, matchedUrl: match.href, resultRank: match.rank });
      return { matchedUrl: match.href, resultPage: pageNumber, resultRank: match.rank };
    }

    const candidates = await retryOnDestroyedContext(() => collectResultCandidates(page));
    await onEvent("google_results_candidates_seen", { pageNumber, candidates });
    await onEvent("google_results_match_not_found", { pageNumber });

    if (pageNumber === maxPages || !(await goToNextResultPage(page, onEvent))) {
      return { matchedUrl: null, resultPage: pageNumber };
    }
  }

  return { matchedUrl: null, resultPage: maxPages };
}

module.exports = {
  findResultAcrossPages
};
