const { HttpError } = require("../Utils/httpError");

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);
const PROXY_FORMAT_MESSAGE = "Proxy must be http://host:port, https://host:port, socks4://host:port, socks5://host:port or socks5://user:pass@host:port";

function normalizeOptionalText(value) {
  const text = String(value || "").trim();
  return ["null", "undefined"].includes(text.toLowerCase()) ? "" : text;
}

function normalizeProxyUrl(value) {
  const proxyUrl = normalizeOptionalText(value);
  if (!proxyUrl) return "";

  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch (error) {
    throw new HttpError(400, PROXY_FORMAT_MESSAGE);
  }
  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    throw new HttpError(400, PROXY_FORMAT_MESSAGE);
  }
  if (!parsed.hostname || !parsed.port) {
    throw new HttpError(400, "Proxy must include host and port");
  }
  if (parsed.protocol === "socks:") {
    parsed.protocol = "socks5:";
    return parsed.href.replace(/\/$/, "");
  }
  return proxyUrl;
}

function normalizeDeviceMode(value) {
  const mode = normalizeOptionalText(value || "desktop").toLowerCase();
  if (!["desktop", "mobile"].includes(mode)) {
    throw new HttpError(400, "Device mode must be desktop or mobile");
  }
  return mode;
}

function normalizeCount(value, fallback = 1) {
  const count = Number(value);
  if (!Number.isFinite(count)) return fallback;
  return Math.min(5, Math.max(1, Math.floor(count)));
}

function normalizeMaxAttempts(value, fallback = 1) {
  const attempts = Number(value);
  if (!Number.isFinite(attempts)) return fallback;
  return Math.min(5, Math.max(1, Math.floor(attempts)));
}

function validateCreateJobPayload(body = {}) {
  const count = normalizeCount(body.count, 1);
  const maxAttempts = normalizeMaxAttempts(body.maxAttempts, 1);
  const proxyUrl = normalizeProxyUrl(body.proxyUrl);
  const proxyResetUrl = normalizeOptionalText(body.proxyResetUrl);
  const deviceMode = normalizeDeviceMode(body.deviceMode);
  const notes = normalizeOptionalText(body.notes);

  return {
    count,
    maxAttempts,
    proxyUrl,
    proxyResetUrl,
    deviceMode,
    notes,
    // Signup her zaman görünür modda; captcha/telefon için insan gerekir.
    headless: false
  };
}

module.exports = {
  validateCreateJobPayload,
  normalizeProxyUrl
};
