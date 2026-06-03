function normalizeHost(input) {
  const raw = String(input || "").trim();
  const url = raw.startsWith("http://") || raw.startsWith("https://")
    ? new URL(raw)
    : new URL(`https://${raw}`);
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

function hostnameMatches(url, targetHost) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === targetHost || host.endsWith(`.${targetHost}`);
  } catch (error) {
    return false;
  }
}

module.exports = { normalizeHost, hostnameMatches };
