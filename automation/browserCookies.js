function toPlaywrightCookie(cookie, targetHost) {
  const playwrightCookie = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain || targetHost,
    path: cookie.path || "/",
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure)
  };

  if (typeof cookie.expires !== "undefined") {
    playwrightCookie.expires = cookie.expires;
  }
  if (cookie.sameSite) {
    playwrightCookie.sameSite = cookie.sameSite;
  }

  return playwrightCookie;
}

async function applyCookies(context, cookies, targetHost) {
  const cleanCookies = (cookies || []).filter((cookie) => cookie.name && typeof cookie.value !== "undefined");
  if (!cleanCookies.length) return;

  await context.addCookies(cleanCookies.map((cookie) => toPlaywrightCookie(cookie, targetHost)));
}

module.exports = { applyCookies };
