const crypto = require("crypto");
const { auth } = require("../../config/app");

const COOKIE_NAME = "hitmaker_token";
const JWT_ALGORITHM = "HS256";

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) return false;

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
}

function sign(value) {
  return crypto.createHmac("sha256", auth.jwtSecret).update(value).digest("base64url");
}

function createToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode({ alg: JWT_ALGORITHM, typ: "JWT" });
  const payload = base64UrlEncode({
    sub: auth.username,
    iat: now,
    exp: now + auth.jwtTtlSeconds
  });
  const unsignedToken = `${header}.${payload}`;

  return `${unsignedToken}.${sign(unsignedToken)}`;
}

function parseCookies(header) {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return cookies;

      const key = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      try {
        cookies[key] = decodeURIComponent(value);
      } catch (error) {
        cookies[key] = value;
      }
      return cookies;
    }, {});
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return "";

  return header.slice(7).trim();
}

class AuthService {
  canLogin(credentials) {
    return timingSafeEqual(credentials.username, auth.username) && timingSafeEqual(credentials.password, auth.password);
  }

  isAuthenticated(req) {
    return Boolean(this.verifyToken(this.getRequestToken(req)));
  }

  getRequestToken(req) {
    const bearerToken = getBearerToken(req);
    if (bearerToken) return bearerToken;

    const cookies = parseCookies(req.headers.cookie);
    return cookies[COOKIE_NAME] || "";
  }

  verifyToken(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    if (!timingSafeEqual(signature || "", sign(unsignedToken))) return null;

    try {
      const header = base64UrlDecode(encodedHeader);
      const payload = base64UrlDecode(encodedPayload);
      const now = Math.floor(Date.now() / 1000);

      if (header.alg !== JWT_ALGORITHM || header.typ !== "JWT") return null;
      if (payload.sub !== auth.username) return null;
      if (!payload.exp || Number(payload.exp) <= now) return null;

      return payload;
    } catch (error) {
      return null;
    }
  }

  attachSession(res) {
    res.cookie(COOKIE_NAME, createToken(), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: auth.jwtTtlSeconds * 1000
    });
  }

  clearSession(res) {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax"
    });
  }
}

module.exports = new AuthService();
