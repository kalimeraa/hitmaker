const fs = require("fs/promises");
const path = require("path");
const { launchBrowserContext } = require("./cloakBrowserClient");

const LOGIN_URL = "https://mrking5018.com/auth/login";
const EMAIL_SELECTORS = [
  'input[placeholder="Kullanıcı adınız / Mail Adresiniz"].input--reset',
  'input[placeholder*="Kullanıcı"]',
  'input[placeholder*="Mail"]',
  'input[name*="user" i]',
  'input[type="text"]'
];
const PASSWORD_SELECTORS = [
  'input[type="password"][placeholder="Şifreniz"].input--reset',
  'input[type="password"][placeholder*="Şifre"]',
  'input[type="password"]'
];
const SUBMIT_SELECTORS = [
  "button.btn--block.login__action-item",
  "button[type=\"submit\"].login__action-item",
  'button:has-text("HEMEN GİRİŞ YAP")',
  'button:has-text("Hemen Giriş Yap")'
];
const EMAIL_AUTH_INPUT_SELECTORS = [
  'input[type="tel"][placeholder*="E-posta"]',
  'input[placeholder*="gelen kod"]'
];
const EMAIL_AUTH_SUBMIT_SELECTORS = [
  'button:has-text("Doğrula")',
  'button[type="submit"]:has-text("Doğrula")'
];
const MANUAL_CHALLENGE_TIMEOUT_MS = 180000;
const EMAIL_AUTH_TIMEOUT_MS = 900000;
const DEBUG_ROOT = path.join(process.cwd(), "storage", "mr-login-debug");

async function collectStorage(page) {
  return page.evaluate(() => ({
    localStorage: Object.keys(window.localStorage || {}).map((key) => ({
      key,
      value: window.localStorage.getItem(key)
    })),
    sessionStorage: Object.keys(window.sessionStorage || {}).map((key) => ({
      key,
      value: window.sessionStorage.getItem(key)
    }))
  })).catch(() => ({ localStorage: [], sessionStorage: [] }));
}

async function collectVisibleText(page) {
  return page.locator("body").innerText({ timeout: 3000 })
    .then((text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 1200))
    .catch(() => "");
}

async function collectCookies(context) {
  const cookies = await context.cookies().catch(() => []);
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite
  }));
}

async function firstVisibleLocator(page, selectors, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const matched = page.locator(selector);
      const count = await matched.count().catch(() => 0);
      if (!count) continue;
      for (let index = 0; index < count; index += 1) {
        const locator = matched.nth(index);
        const visible = await locator.isVisible().catch(() => false);
        if (visible) return locator;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Visible element not found: ${selectors.join(" | ")}`);
}

async function captureDebugArtifact(page, onEvent, name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `${stamp}-${name}`;
  const screenshotPath = path.join(DEBUG_ROOT, `${baseName}.png`);
  const htmlPath = path.join(DEBUG_ROOT, `${baseName}.html`);

  try {
    await fs.mkdir(DEBUG_ROOT, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 10000 });
    await fs.writeFile(htmlPath, await page.content(), "utf8");
    await onEvent("mr_login_debug_artifact_saved", "Debug screenshot ve HTML kaydedildi.", {
      screenshotPath,
      htmlPath,
      url: page.url()
    });
  } catch (error) {
    await onEvent("mr_login_debug_artifact_failed", "Debug screenshot/HTML kaydedilemedi.", {
      error: error.message || "unknown_error",
      url: page.url()
    });
  }
}

async function isProtectedAuthModal(modal) {
  const text = await modal.innerText({ timeout: 1000 }).catch(() => "");
  return /Email Authentication|E-postanıza gelen kodu giriniz|Doğrula|SPAM ve GEREKSİZ/i.test(String(text || ""));
}

async function closeBlockingModals(page, onEvent, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 8000);
  const pollMs = Number(options.pollMs || 300);
  const firstPopupWaitMs = Number(options.firstPopupWaitMs || 2500);
  const afterCloseQuietMs = Number(options.afterCloseQuietMs || 900);
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let lastClosedAt = 0;
  let closedCount = 0;

  while (Date.now() < deadline) {
    const modal = page.locator(".app-modal__root:visible").first();
    const hasModal = await modal.count().catch(() => 0);
    const modalVisible = hasModal ? await modal.isVisible().catch(() => false) : false;
    if (!modalVisible) {
      if (!closedCount && Date.now() - startedAt >= firstPopupWaitMs) break;
      if (closedCount && Date.now() - lastClosedAt >= afterCloseQuietMs) break;
      await page.waitForTimeout(pollMs).catch(() => {});
      continue;
    }

    if (await isProtectedAuthModal(modal)) {
      await onEvent("mr_login_auth_modal_preserved", "Email doğrulama modalı açık; popup kapatma bu modalı kapatmadı.");
      break;
    }

    const hasNotification = await modal.locator(".app-notification").count().catch(() => 0);
    if (!hasNotification) {
      await onEvent("mr_login_unknown_modal_preserved", "Bilinmeyen modal kapatılmadı; manuel kontrol için açık bırakıldı.");
      break;
    }

    const closeButton = modal.locator(".app-modal__close").first();
    const isVisible = await closeButton.isVisible().catch(() => false);
    if (!isVisible) break;

    await closeButton.click({ timeout: 5000 }).catch(async () => {
      await page.keyboard.press("Escape").catch(() => {});
    });
    closedCount += 1;
    lastClosedAt = Date.now();
    await onEvent("mr_login_modal_closed", "MR bildirim popup'ı kapatıldı.", { closedCount });
    await page.waitForTimeout(700);
  }

  if (!closedCount) {
    await onEvent("mr_login_modal_not_detected", "Kapatılacak MR popup görünmedi.");
  }
}

async function findTurnstileChallenge(page) {
  return page.evaluate(() => {
    const widget = document.querySelector(".cf-turnstile[data-sitekey], [data-sitekey]");
    const iframe = Array.from(document.querySelectorAll("iframe"))
      .find((item) => /challenges\.cloudflare\.com\/turnstile/i.test(item.src || ""));
    const params = iframe ? new URL(iframe.src).searchParams : null;
    const sitekey = (widget && widget.getAttribute("data-sitekey"))
      || (params && (params.get("sitekey") || params.get("k")))
      || "";
    return {
      found: Boolean(sitekey || iframe || document.querySelector('input[name="cf-turnstile-response"]')),
      sitekey
    };
  }).catch(() => ({ found: false, sitekey: "" }));
}

async function waitForManualTurnstileIfPresent(page, onEvent) {
  const challenge = await findTurnstileChallenge(page);
  if (!challenge.found) {
    await onEvent("mr_login_turnstile_not_detected", "Turnstile widget görünmedi.");
    return;
  }

  await onEvent("mr_login_turnstile_manual_required", "Turnstile/Cloudflare kontrolü çıktı; görünür tarayıcıda manuel çözüm bekleniyor.", {
    url: page.url(),
    hasSitekey: Boolean(challenge.sitekey)
  });
  await page.waitForFunction(() => {
    const iframe = Array.from(document.querySelectorAll("iframe"))
      .find((item) => /challenges\.cloudflare\.com\/turnstile/i.test(item.src || ""));
    const widget = document.querySelector(".cf-turnstile[data-sitekey], [data-sitekey]");
    return !iframe && !widget;
  }, null, { timeout: MANUAL_CHALLENGE_TIMEOUT_MS }).catch(() => {});
  await onEvent("mr_login_turnstile_wait_finished", "Turnstile manuel bekleme tamamlandı.", { url: page.url() });
}

async function waitForEmailAuthenticationIfPresent(page, onEvent, getEmailAuthCode = async () => "") {
  const detectionDeadline = Date.now() + 60000;
  let isVisible = false;
  while (Date.now() < detectionDeadline) {
    isVisible = await isEmailAuthenticationVisible(page);
    if (isVisible) break;
    if (await isLoginCompleted(page)) {
      await onEvent("mr_login_email_auth_not_detected", "Email doğrulama modalı görünmedi; giriş tamamlanmış görünüyor.", {
        url: page.url()
      });
      return;
    }
    await page.waitForTimeout(1000).catch(() => {});
  }
  if (!isVisible) {
    await onEvent("mr_login_email_auth_not_detected", "Email doğrulama modalı görünmedi.");
    return;
  }

  await onEvent("mr_login_email_auth_required", "Email doğrulama kodu bekleniyor; kodu panelden gir.", {
    url: page.url()
  });
  await captureDebugArtifact(page, onEvent, "email-auth-required");

  const codeDeadline = Date.now() + EMAIL_AUTH_TIMEOUT_MS;
  let lastSubmittedCode = "";
  while (Date.now() < codeDeadline) {
    const authVisible = await isEmailAuthenticationVisible(page);
    const code = String(await getEmailAuthCode() || "").trim();
    if (code && code !== lastSubmittedCode && authVisible) {
      const codeInput = await firstVisibleLocator(page, EMAIL_AUTH_INPUT_SELECTORS, 10000);
      await codeInput.fill("");
      await codeInput.fill(code);
      await onEvent("mr_login_email_auth_code_filled", "Email doğrulama kodu forma yazıldı.");
      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
        firstVisibleLocator(page, EMAIL_AUTH_SUBMIT_SELECTORS, 10000).then((button) => button.click())
      ]);
      lastSubmittedCode = code;
      await onEvent("mr_login_email_auth_submitted", "Email doğrulama kodu gönderildi.", { url: page.url() });
      await page.waitForTimeout(5000).catch(() => {});

      if (await isEmailAuthenticationVisible(page)) {
        const authError = await detectEmailAuthError(page);
        if (authError) {
          await onEvent("mr_login_email_auth_code_rejected", "Email doğrulama kodu reddedildi; yeni kod bekleniyor.", {
            reason: authError
          });
          await captureDebugArtifact(page, onEvent, "email-auth-code-rejected");
        } else {
          await onEvent("mr_login_email_auth_still_visible", "Email doğrulama modalı kapanmadı; yeni/tekrar kod bekleniyor.", {
            url: page.url()
          });
        }
        await clearEmailAuthInput(page);
        continue;
      }

      if (await isLoginCompleted(page)) {
        break;
      }
    }
    if (!authVisible) {
      break;
    }
    await page.waitForTimeout(1000).catch(() => {});
  }

  await onEvent("mr_login_email_auth_wait_finished", "Email doğrulama beklemesi tamamlandı.", {
    url: page.url()
  });
}

async function isEmailAuthenticationVisible(page) {
  try {
    await firstVisibleLocator(page, EMAIL_AUTH_INPUT_SELECTORS, 1000);
    return true;
  } catch (error) {
    // Fall through to text detection.
  }

  return page.locator("body").innerText({ timeout: 1000 })
    .then((text) => /Email Authentication|E-postanıza gelen kodu giriniz|Doğrula|SPAM ve GEREKSİZ/i.test(String(text || "")))
    .catch(() => false);
}

async function detectEmailAuthError(page) {
  const text = await page.locator("body").innerText({ timeout: 1000 })
    .then((value) => String(value || "").replace(/\s+/g, " ").trim())
    .catch(() => "");

  if (/geçersiz|gecersiz|süresi dol|suresi dol|expired|invalid/i.test(text)) {
    return text.slice(0, 500);
  }

  return "";
}

async function clearEmailAuthInput(page) {
  try {
    const input = await firstVisibleLocator(page, EMAIL_AUTH_INPUT_SELECTORS, 1000);
    await input.fill("");
  } catch (error) {
    // Best effort only; the modal may have closed.
  }
}

async function isLoginCompleted(page) {
  if (!/\/auth\/login/i.test(page.url())) return true;
  const loginStillVisible = await Promise.any(SUBMIT_SELECTORS.map((selector) => (
    page.locator(selector).first().isVisible({ timeout: 300 })
  ))).catch(() => false);
  return !loginStillVisible;
}

async function readLocatorValue(locator) {
  return locator.inputValue({ timeout: 1000 }).catch(() => "");
}

async function fillLoginForm(page, email, password, onEvent) {
  const emailInput = await firstVisibleLocator(page, EMAIL_SELECTORS, 15000);
  await emailInput.fill(email);
  await onEvent("mr_login_email_filled", "Email / kullanıcı adı girildi.", { email });

  const passwordInput = await firstVisibleLocator(page, PASSWORD_SELECTORS, 15000);
  await passwordInput.fill(password);
  await onEvent("mr_login_password_filled", "Şifre girildi.");

  await page.waitForTimeout(400).catch(() => {});

  const verifiedEmailInput = await firstVisibleLocator(page, EMAIL_SELECTORS, 5000);
  const verifiedPasswordInput = await firstVisibleLocator(page, PASSWORD_SELECTORS, 5000);
  const currentEmail = await readLocatorValue(verifiedEmailInput);
  const currentPassword = await readLocatorValue(verifiedPasswordInput);
  const hasEmail = currentEmail === email;
  const hasPassword = currentPassword.length > 0;

  await onEvent("mr_login_form_values_verified", "Login form değerleri kontrol edildi.", {
    hasEmail,
    passwordLength: currentPassword.length
  });

  if (!hasEmail || !hasPassword) {
    await captureDebugArtifact(page, onEvent, "form-verification-failed");
    throw new Error("MR login form değerleri doğrulanamadı");
  }
}

async function tryFillLoginForm(page, email, password, onEvent) {
  try {
    await fillLoginForm(page, email, password, onEvent);
    return true;
  } catch (error) {
    await onEvent("mr_login_form_values_retry", "Login formu doğrulanamadı; tekrar doldurma deneniyor.", {
      error: error.message || "unknown_error"
    });
    return false;
  }
}

async function clickSubmitButton(page, onEvent) {
  const submitButton = await firstVisibleLocator(page, SUBMIT_SELECTORS, 15000);
  const isDisabled = await submitButton.evaluate((button) => (
    Boolean(button.disabled || button.getAttribute("aria-disabled") === "true" || button.classList.contains("disabled"))
  )).catch(() => false);

  await onEvent("mr_login_submit_button_checked", "Hemen Giriş Yap butonu kontrol edildi.", { isDisabled });

  if (isDisabled) {
    throw new Error("MR login submit butonu pasif; email/şifre formu dolu değil");
  }

  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
    submitButton.click()
  ]);
}

async function prepareLoginForm(page, email, password, onEvent) {
  await closeBlockingModals(page, onEvent, { timeoutMs: 10000 });
  await tryFillLoginForm(page, email, password, onEvent);
  await closeBlockingModals(page, onEvent, { timeoutMs: 5000 });
  await fillLoginForm(page, email, password, onEvent);
}

async function runMrKingLogin({
  email,
  password,
  loginUrl = LOGIN_URL,
  profileKey,
  proxyUrl = "",
  getEmailAuthCode = async () => "",
  onEvent = async () => {}
}) {
  let context;
  let page;
  try {
    await onEvent("mr_login_browser_launching", "CloakBrowser görünür profil ile açılıyor.", { profileKey });
    context = await launchBrowserContext({
      headless: false,
      profileKey,
      proxyUrl,
      deviceMode: "desktop"
    });

    const defaultPages = context.pages ? context.pages() : [];
    await Promise.all(defaultPages.map((item) => item.close().catch(() => {})));

    page = await context.newPage();
    await onEvent("mr_login_navigation_started", "MR login sayfasına gidiliyor.", { url: loginUrl });
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    await onEvent("mr_login_navigation_completed", "Login sayfası yüklendi.", { url: page.url() });

    await closeBlockingModals(page, onEvent, { timeoutMs: 10000 });
    await waitForManualTurnstileIfPresent(page, onEvent);

    await prepareLoginForm(page, email, password, onEvent);
    await clickSubmitButton(page, onEvent);
    await onEvent("mr_login_submit_clicked", "Hemen Giriş Yap butonuna tıklandı.", { url: page.url() });
    await captureDebugArtifact(page, onEvent, "after-submit-click");

    await page.waitForTimeout(4000);
    await waitForManualTurnstileIfPresent(page, onEvent);
    await closeBlockingModals(page, onEvent, { timeoutMs: 5000 });
    await waitForEmailAuthenticationIfPresent(page, onEvent, getEmailAuthCode);
    await page.waitForTimeout(8000);

    const url = page.url();
    const cookies = await collectCookies(context);
    const storage = await collectStorage(page);
    const loginStillVisible = await Promise.any(SUBMIT_SELECTORS.map((selector) => (
      page.locator(selector).first().isVisible({ timeout: 500 })
    ))).catch(() => false);
    const emailAuthVisible = await isEmailAuthenticationVisible(page);
    const hasAuthCookie = cookies.some((cookie) => /session|token|auth|jwt/i.test(cookie.name));
    const success = !loginStillVisible && !emailAuthVisible && (!/\/auth\/login/i.test(url) || hasAuthCookie);
    const visibleText = success ? "" : await collectVisibleText(page);

    await onEvent(success ? "mr_login_success_detected" : "mr_login_success_uncertain", success
      ? "Giriş başarılı görünüyor; cookie ve session bilgisi toplandı."
      : "Giriş sonucu net doğrulanamadı; mevcut cookie ve session bilgisi toplandı.", {
      url,
      cookieCount: cookies.length,
      localStorageCount: storage.localStorage.length,
      sessionStorageCount: storage.sessionStorage.length,
      loginStillVisible,
      emailAuthVisible,
      visibleText
    });
    await onEvent("mr_login_final_observation", "Tarayıcı sonucu görebilmen için kısa süre açık tutuluyor.", { url });
    await page.waitForTimeout(success ? 15000 : 60000).catch(() => {});

    return {
      success,
      url,
      cookies,
      session: {
        url,
        localStorage: storage.localStorage,
        sessionStorage: storage.sessionStorage
      },
      error: success ? "" : "login_success_uncertain"
    };
  } catch (error) {
    if (page && !page.isClosed()) {
      await captureDebugArtifact(page, onEvent, "failure").catch(() => {});
    }
    await onEvent("mr_login_failed", "MR giriş akışı hata verdi.", { error: error.message || "unknown_error" });
    return { success: false, error: error.message || "mr_login_failed", url: "" };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

module.exports = {
  LOGIN_URL,
  runMrKingLogin
};
