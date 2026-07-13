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

function validateWarmupPayload(payload = {}) {
  const loginUrl = clean(payload.loginUrl) || DEFAULT_LOGIN_URL;
  const proxyUrl = clean(payload.proxyUrl);
  const browserCount = Math.max(1, Math.min(Number(payload.browserCount) || 1, 4));

  if (!/^https?:\/\/[^ ]+$/i.test(loginUrl)) throw new HttpError(422, "MR login adresi geçersiz");

  return {
    loginUrl,
    proxyUrl,
    browserCount
  };
}

function validateCredentialPayload(payload = {}) {
  const email = clean(payload.email) || DEFAULT_EMAIL;
  const password = clean(payload.password) || DEFAULT_PASSWORD;

  if (!email) throw new HttpError(422, "Email / kullanıcı adı gerekli");
  if (!password) throw new HttpError(422, "Şifre gerekli");

  return { email, password };
}

function validateEmailCodePayload(payload = {}, routeJobId = "") {
  const jobId = clean(routeJobId || payload.jobId || payload.id);
  const email = clean(payload.email);
  const code = clean(payload.code);

  if (!code) throw new HttpError(422, "Email doğrulama kodu gerekli");
  if (!jobId && !email) throw new HttpError(422, "Email doğrulama kodu için jobId veya email gerekli");

  return { jobId, email, code };
}

function validateProxyLoginPayload(payload = {}) {
  const email = clean(payload.email) || DEFAULT_EMAIL;
  const password = clean(payload.password) || DEFAULT_PASSWORD;
  const loginUrl = clean(payload.loginUrl) || DEFAULT_LOGIN_URL;

  if (!email) throw new HttpError(422, "Email / kullanıcı adı gerekli");
  if (!password) throw new HttpError(422, "Şifre gerekli");
  if (!/^https?:\/\/[^ ]+$/i.test(loginUrl)) throw new HttpError(422, "MR login adresi geçersiz");

  return { email, password, loginUrl };
}

module.exports = {
  DEFAULT_EMAIL,
  DEFAULT_PASSWORD,
  DEFAULT_LOGIN_URL,
  validateLaunchPayload,
  validateWarmupPayload,
  validateCredentialPayload,
  validateEmailCodePayload,
  validateProxyLoginPayload
};
