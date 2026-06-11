const { HttpError } = require("../Utils/httpError");
const { parseCookieSets, normalizeOptionalText } = require("./taskValidator");

function validateCookiePoolImportPayload(body) {
  const targetAddress = normalizeOptionalText(body.targetAddress || "google.com") || "google.com";
  const cookieSets = parseCookieSets(body.cookieSets, targetAddress);

  if (!cookieSets.length) {
    throw new HttpError(400, "At least one valid cookie file is required");
  }

  return {
    targetAddress,
    cookieSets,
    notes: normalizeOptionalText(body.notes)
  };
}

function validateCookiePoolUpdatePayload(body) {
  const name = normalizeOptionalText(body.name);
  if (!name) {
    throw new HttpError(400, "Cookie name is required");
  }

  return {
    name: name.slice(0, 180),
    notes: normalizeOptionalText(body.notes).slice(0, 500)
  };
}

function validateCookiePoolStatusPayload(body) {
  const status = normalizeOptionalText(body.status).toLowerCase();
  if (!["active", "disabled", "broken"].includes(status)) {
    throw new HttpError(400, "Cookie status must be active, disabled or broken");
  }

  return {
    status,
    reason: normalizeOptionalText(body.reason).slice(0, 500)
  };
}

module.exports = {
  validateCookiePoolImportPayload,
  validateCookiePoolUpdatePayload,
  validateCookiePoolStatusPayload
};
