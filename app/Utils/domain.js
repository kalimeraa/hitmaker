function normalizeHost(input) {
  const raw = String(input || "").trim();
  const url = raw.startsWith("http://") || raw.startsWith("https://")
    ? new URL(raw)
    : new URL(`https://${raw}`);
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

function normalizePath(pathname) {
  const decoded = decodeURIComponent(String(pathname || "/"));
  const withoutTrailingSlash = decoded.replace(/\/+$/, "");
  return (withoutTrailingSlash || "/").toLowerCase();
}

function normalizeTarget(input) {
  const raw = String(input || "").trim();
  const url = raw.startsWith("http://") || raw.startsWith("https://")
    ? new URL(raw)
    : new URL(`https://${raw}`);
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = normalizePath(url.pathname);

  return {
    host,
    path,
    hasPath: path !== "/",
    href: url.toString()
  };
}

function hostnameMatches(url, targetHost) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === targetHost || host.endsWith(`.${targetHost}`);
  } catch (error) {
    return false;
  }
}

function targetMatchesUrl(url, target) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const hostMatches = host === target.host || host.endsWith(`.${target.host}`);
    if (!hostMatches) return false;
    if (!target.hasPath) return true;

    return normalizePath(parsed.pathname) === target.path;
  } catch (error) {
    return false;
  }
}

module.exports = {
  normalizeHost,
  normalizeTarget,
  hostnameMatches,
  targetMatchesUrl
};
