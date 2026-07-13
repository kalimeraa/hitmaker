const authService = require("../../Services/authService");

const PUBLIC_API_ROUTES = [
  { method: "POST", path: "/api/mr-giris/browsers" },
  { method: "POST", path: "/api/mr-giris/login" },
  { method: "POST", path: "/api/mr-giris/email-code" }
];

function wantsJson(req) {
  return req.originalUrl.startsWith("/api/") || req.accepts(["html", "json"]) === "json";
}

function normalizePath(req) {
  const path = req.path || String(req.originalUrl || "").split("?")[0];
  return String(path || "").replace(/\/+$/, "") || "/";
}

function isPublicApiRoute(req) {
  const method = String(req.method || "").toUpperCase();
  const path = normalizePath(req);

  return PUBLIC_API_ROUTES.some((route) => route.method === method && route.path === path);
}

function requireAuth(req, res, next) {
  if (isPublicApiRoute(req)) {
    next();
    return;
  }

  if (authService.isAuthenticated(req)) {
    next();
    return;
  }

  if (wantsJson(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || "/")}`);
}

module.exports = { requireAuth, isPublicApiRoute };
