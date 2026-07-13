const { HttpError } = require("../Utils/httpError");

const DEFAULT_EMAIL = "kadanfurkan0@gmail.com";
const DEFAULT_PASSWORD = "ZzWUHW7VYNWp";
const DEFAULT_LOGIN_URL = "https://mrking5018.com/auth/login";

function clean(value) {
  return String(value || "").trim();
}

function validateLaunchPayload(payload = {}) {
  const email = clean(payload.email) || DEFAULT_EMAIL;
  const password = clean(payload.password) || DEFAULT_PASSWORD;
  const loginUrl = clean(payload.loginUrl) || DEFAULT_LOGIN_URL;
  const proxyUrl = clean(payload.proxyUrl);

  if (!email) throw new HttpError(422, "Email / kullanıcı adı gerekli");
  if (!password) throw new HttpError(422, "Şifre gerekli");
  if (!/^https?:\/\/[^ ]+$/i.test(loginUrl)) throw new HttpError(422, "MR login adresi geçersiz");

  return {
    email,
    password,
    loginUrl,
    proxyUrl,
    headless: false
  };
}

module.exports = {
  DEFAULT_EMAIL,
  DEFAULT_PASSWORD,
  DEFAULT_LOGIN_URL,
  validateLaunchPayload
};
