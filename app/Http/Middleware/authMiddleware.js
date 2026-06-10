const authService = require("../../Services/authService");

function wantsJson(req) {
  return req.originalUrl.startsWith("/api/") || req.accepts(["html", "json"]) === "json";
}

function requireAuth(req, res, next) {
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

module.exports = { requireAuth };
