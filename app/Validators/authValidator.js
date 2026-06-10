function validateLoginPayload(payload = {}) {
  return {
    username: String(payload.username || "").trim(),
    password: String(payload.password || "")
  };
}

function normalizeRedirectPath(path) {
  const value = String(path || "/");
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/login")) return "/";

  return value;
}

module.exports = {
  validateLoginPayload,
  normalizeRedirectPath
};
