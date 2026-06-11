const { normalizeHost } = require("../Utils/domain");
const { HttpError } = require("../Utils/httpError");
const { maxParallelBrowsers } = require("../../config/app");

function parseKeywords(value) {
  return String(value || "")
    .split(/\r?\n|,/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeOptionalText(value) {
  const text = String(value || "").trim();
  return ["null", "undefined"].includes(text.toLowerCase()) ? "" : text;
}

function normalizeProxyUrl(value) {
  const proxyUrl = normalizeOptionalText(value);
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

function parseDurationHours(value) {
  if (value === "" || typeof value === "undefined" || value === null) return 0;

  const durationHours = Number(value);
  if (!Number.isFinite(durationHours) || durationHours < 0 || durationHours > 720) {
    throw new HttpError(400, "Duration hours must be a number between 0 and 720");
  }

  return durationHours;
}

function parseMaxAttempts(value) {
  if (value === "" || typeof value === "undefined" || value === null) return 3;

  const maxAttempts = Number(value);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new HttpError(400, "Max attempts must be an integer between 1 and 10");
  }

  return maxAttempts;
}

function parseMaxConcurrentBrowsers(value) {
  if (value === "" || typeof value === "undefined" || value === null) return 2;

  const maxConcurrentBrowsers = Number(value);
  const maxAllowed = Math.max(2, Number(maxParallelBrowsers) || 2);
  if (!Number.isInteger(maxConcurrentBrowsers) || maxConcurrentBrowsers < 1 || maxConcurrentBrowsers > maxAllowed) {
    throw new HttpError(400, `Concurrent browsers must be an integer between 1 and ${maxAllowed}`);
  }

  return maxConcurrentBrowsers;
}

function parseDeviceMode(value) {
  const deviceMode = normalizeOptionalText(value || "desktop").toLowerCase();
  if (!["desktop", "mobile"].includes(deviceMode)) {
    throw new HttpError(400, "Device mode must be desktop or mobile");
  }

  return deviceMode;
}

function extractCookieText(value) {
  const raw = normalizeOptionalText(value);
  const cookieOption = raw.match(/(?:^|\s)(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/);
  if (cookieOption) return cookieOption[2];

  const cookieHeader = raw.match(/(?:^|\s)-H\s+(['"])cookie\s*:\s*([\s\S]*?)\1/i);
  if (cookieHeader) return cookieHeader[2];

  return raw;
}

function normalizeCookieInput(raw) {
  return extractCookieText(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.toLowerCase() !== "cookie")
    .map((line) => line.replace(/^cookie\s*:\s*/i, ""))
    .join("; ");
}

function cookieDomainForName(name, targetHost) {
  if (/^(SID|HSID|SSID|APISID|SAPISID|NID|AEC|OTZ|UULE|SIDCC|SEARCH_SAMESITE)$/i.test(name)) {
    return ".google.com";
  }
  if (/^__Secure-(1P|3P)?(SID|PSID|APISID|PAPISID|SIDTS|PSIDTS|SIDCC|PSIDCC|STRP)$/i.test(name)) {
    return ".google.com";
  }

  return targetHost;
}

function parseNetscapeCookieLines(raw) {
  return normalizeOptionalText(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("# ") && !line.startsWith("#\t"))
    .filter((line) => !line.startsWith("# Netscape") && !line.startsWith("# https://") && !line.startsWith("# This is"))
    .map((line) => {
      const httpOnly = line.startsWith("#HttpOnly_");
      const cleanLine = httpOnly ? line.replace(/^#HttpOnly_/, "") : line;
      const parts = cleanLine.split(/\s+/);

      if (parts.length < 7) {
        throw new Error("Netscape cookie lines must have 7 fields");
      }

      const [domain, , path, secure, expires, name, ...valueParts] = parts;
      return {
        name,
        value: valueParts.join("\t"),
        domain,
        path: path || "/",
        expires: Number(expires) || undefined,
        httpOnly,
        secure: String(secure).toUpperCase() === "TRUE"
      };
    });
}

function isNetscapeCookieInput(raw) {
  return normalizeOptionalText(raw)
    .split(/\r?\n/)
    .some((line) => {
      const cleanLine = line.trim().replace(/^#HttpOnly_/, "");
      return cleanLine.split(/\s+/).length >= 7;
    });
}

function parseCookieHeaderPairs(raw, targetHost) {
  if (isNetscapeCookieInput(raw)) {
    return parseNetscapeCookieLines(raw);
  }

  return normalizeCookieInput(raw)
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator <= 0) {
        throw new Error("Cookie lines must use name=value format");
      }

      const name = line.slice(0, separator).trim();
      return {
        name,
        value: line.slice(separator + 1).trim(),
        domain: cookieDomainForName(name, targetHost),
        path: "/",
        secure: name.startsWith("__Secure-")
      };
    });
}

function parseCookies(value, targetAddress) {
  const raw = normalizeOptionalText(value);
  if (!raw) return [];

  const targetHost = normalizeHost(targetAddress);
  let cookies;

  try {
    if (raw.startsWith("[") || raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      cookies = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cookies) ? parsed.cookies : [parsed]);
    } else {
      cookies = parseCookieHeaderPairs(raw, targetHost);
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
      expires: Number(cookie.expires) > 0 ? Number(cookie.expires) : undefined,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite ? String(cookie.sameSite) : undefined
    };
  }).slice(0, 100);
}

function parseCookieSets(value, targetAddress) {
  const rawSets = Array.isArray(value) ? value : [];

  return rawSets
    .slice(0, 50)
    .map((cookieSet, index) => {
      const name = normalizeOptionalText(cookieSet && cookieSet.name) || `cookie-set-${index + 1}`;
      const source = typeof cookieSet.content !== "undefined"
        ? cookieSet.content
        : JSON.stringify(cookieSet.cookies || []);
      return {
        name: name.slice(0, 180),
        cookies: parseCookies(source, targetAddress)
      };
    })
    .filter((cookieSet) => cookieSet.cookies.length);
}

function parseCookiePayload(body, targetAddress) {
  const explicitCookieSets = parseCookieSets(body.cookieSets, targetAddress);
  if (explicitCookieSets.length) {
    return { cookies: [], cookieSets: explicitCookieSets };
  }

  const raw = normalizeOptionalText(body.cookies);
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const embeddedCookieSets = parseCookieSets(parsed.cookieSets, targetAddress);
      if (embeddedCookieSets.length) {
        return { cookies: [], cookieSets: embeddedCookieSets };
      }
    } catch (error) {
      throw new HttpError(400, `Invalid cookies: ${error.message}`);
    }
  }

  return { cookies: parseCookies(body.cookies, targetAddress), cookieSets: [] };
}

function validateCreateTaskPayload(body) {
  const keywords = parseKeywords(body.keywords);
  const count = Number(body.clickCount ?? body.count);
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

  const cookiePayload = parseCookiePayload(body, targetAddress);

  return {
    keywords,
    count,
    maxConcurrentBrowsers: parseMaxConcurrentBrowsers(body.maxConcurrentBrowsers),
    maxAttempts: parseMaxAttempts(body.maxAttempts ?? body.tries),
    durationHours: parseDurationHours(body.durationHours),
    targetAddress,
    headless: Boolean(body.headless),
    deviceMode: parseDeviceMode(body.deviceMode),
    proxyUrl: normalizeProxyUrl(body.proxyUrl),
    useCookiePool: Boolean(body.useCookiePool),
    cookies: cookiePayload.cookies,
    cookieSets: cookiePayload.cookieSets
  };
}

module.exports = {
  validateCreateTaskPayload,
  parseCookieSets,
  normalizeOptionalText
};
