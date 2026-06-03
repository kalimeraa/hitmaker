const { normalizeHost } = require("../Utils/domain");
const { HttpError } = require("../Utils/httpError");

function parseKeywords(value) {
  return String(value || "")
    .split(/\r?\n|,/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeProxyUrl(value) {
  const proxyUrl = String(value || "").trim();
  if (!proxyUrl) return "";

  const parsed = new URL(proxyUrl);
  if (!["http:", "https:", "socks4:", "socks5:"].includes(parsed.protocol)) {
    throw new HttpError(400, "Proxy must be http://host:port, https://host:port, socks4://host:port or socks5://host:port");
  }
  if (!parsed.hostname || !parsed.port) {
    throw new HttpError(400, "Proxy must include host and port");
  }
  return proxyUrl;
}

function parseCookies(value, targetAddress) {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const targetHost = normalizeHost(targetAddress);
  let cookies;

  try {
    if (raw.startsWith("[") || raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      cookies = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      cookies = raw.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf("=");
          if (separator <= 0) {
            throw new Error("Cookie lines must use name=value format");
          }
          return {
            name: line.slice(0, separator).trim(),
            value: line.slice(separator + 1).trim(),
            domain: targetHost,
            path: "/"
          };
        });
    }
  } catch (error) {
    throw new HttpError(400, `Invalid cookies: ${error.message}`);
  }

  return cookies.map((cookie) => {
    if (!cookie.name || typeof cookie.value === "undefined") {
      throw new HttpError(400, "Invalid cookies: cookie name and value are required");
    }
    return {
      name: String(cookie.name),
      value: String(cookie.value),
      domain: cookie.domain ? String(cookie.domain) : targetHost,
      path: cookie.path ? String(cookie.path) : "/",
      expires: cookie.expires ? Number(cookie.expires) : undefined,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite ? String(cookie.sameSite) : undefined
    };
  }).slice(0, 100);
}

function validateCreateTaskPayload(body) {
  const keywords = parseKeywords(body.keywords);
  const count = Number(body.count);
  const targetAddress = String(body.targetAddress || "").trim();

  if (!keywords.length) {
    throw new HttpError(400, "At least one keyword is required");
  }
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new HttpError(400, "Count must be an integer between 1 and 50");
  }
  try {
    normalizeHost(targetAddress);
  } catch (error) {
    throw new HttpError(400, "Target address must be a valid domain or URL");
  }

  return {
    keywords,
    count,
    targetAddress,
    headless: Boolean(body.headless),
    proxyUrl: normalizeProxyUrl(body.proxyUrl),
    cookies: parseCookies(body.cookies, targetAddress)
  };
}

module.exports = { validateCreateTaskPayload };
