const speakeasy = require("speakeasy");
const { taskTimeoutMs } = require("../../config/app");
const { launchBrowserContext } = require("./cloakBrowserClient");
const { solveRecaptchaOnPage, hasApiKey } = require("./recaptchaSolver");

const DEFAULT_LOGIN_URL = "https://accounts.google.com/signin/v2/identifier?service=mail";
const GOOGLE_COOKIE_URLS = [
  "https://www.google.com",
  "https://accounts.google.com",
  "https://mail.google.com"
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 250, max = 800) {
  return delay(min + Math.floor(Math.random() * (max - min)));
}

function normalizeTwoFaSecret(twoFaSecret) {
  return String(twoFaSecret || "").replace(/\s+/g, "").toUpperCase();
}

function generateTotp(twoFaSecret) {
  const normalized = normalizeTwoFaSecret(twoFaSecret);
  if (!normalized) {
    return { success: false, error: "two_fa_secret_missing" };
  }

  try {
    const code = speakeasy.totp({
      secret: normalized,
      encoding: "base32",
      digits: 6,
      step: 30
    });

    if (!/^\d{6}$/.test(code)) {
      return { success: false, error: "two_fa_code_not_generated" };
    }

    return { success: true, code };
  } catch (error) {
    return { success: false, error: error.message || "two_fa_code_not_generated" };
  }
}

// Seconds left in the current 30s TOTP window.
function totpSecondsRemaining(step = 30) {
  return step - (Math.floor(Date.now() / 1000) % step);
}

// A TOTP code is only valid for the rest of its 30s window. If we generate one with little time
// left, it can expire between fill and submit → Google shows "Wrong code". So when the window is
// about to roll, wait for the next one, then generate a fresh code that stays valid through submit.
async function generateTotpWindowSafe(twoFaSecret, onEvent = async () => {}, minRemainingMs = 6000) {
  const remainingMs = totpSecondsRemaining() * 1000;
  if (remainingMs < minRemainingMs) {
    await onEvent("google_auth_2fa_window_wait", { remainingMs });
    await delay(remainingMs + 500);
  }
  const result = generateTotp(twoFaSecret);
  result.secondsRemaining = totpSecondsRemaining();
  return result;
}

// Detects Google's "Wrong code. Try again." (and localized) error on the 2FA page.
async function detectWrongTotpCode(page) {
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  return /Wrong code|Yanlış kod|incorrect code|hatalı kod|try again|tekrar deneyin/i.test(text);
}

function isRecaptchaChallengeUrl(url = "") {
  return /accounts\.google\.com\/.*signin\/challenge\/recaptcha/i.test(url);
}

function isTwoFactorChallengeUrl(url = "") {
  return /accounts\.google\.com\/.*signin\/challenge/i.test(url) && !isRecaptchaChallengeUrl(url);
}

async function detectTwoFactorChallenge(page) {
  const url = page.url();
  if (isRecaptchaChallengeUrl(url)) {
    return null;
  }
  if (isTwoFactorChallengeUrl(url)) {
    return { reason: "challenge_url", url };
  }

  const textCandidates = [
    "2 Adımlı Doğrulama",
    "İki Adımlı Doğrulama",
    "Two-step verification",
    "2-Step Verification",
    "Verify it\u0027s you",
    "Hesabınızın güvenliğini korumak için"
  ];

  for (const text of textCandidates) {
    const visible = await page.getByText(text, { exact: false }).first().isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      return { reason: "challenge_text", url, text };
    }
  }

  return null;
}

async function detectRecaptchaChallenge(page) {
  const url = page.url();
  if (isRecaptchaChallengeUrl(url)) {
    return { reason: "recaptcha_url", url };
  }

  const textCandidates = [
    "Confirm you’re not a robot",
    "Confirm you're not a robot",
    "I'm not a robot",
    "Robot olmadığınızı doğrulayın",
    "reCAPTCHA"
  ];

  for (const text of textCandidates) {
    const visible = await page.getByText(text, { exact: false }).first().isVisible({ timeout: 800 }).catch(() => false);
    if (visible) {
      return { reason: "recaptcha_text", url, text };
    }
  }

  return null;
}

async function detectUnsafeBrowser(page) {
  const textCandidates = [
    "Tarayıcı veya uygulama güvenli olmayabilir",
    "This browser or app may not be secure"
  ];

  for (const text of textCandidates) {
    const visible = await page.getByText(text, { exact: false }).first().isVisible({ timeout: 800 }).catch(() => false);
    if (visible) {
      return { reason: "unsafe_browser", url: page.url(), text };
    }
  }

  return null;
}

async function humanType(locator, text) {
  await locator.focus({ timeout: 10000 });
  await randomDelay(180, 450);

  for (const char of String(text)) {
    await locator.type(char, { delay: 25 + Math.floor(Math.random() * 55) });
  }

  await randomDelay(180, 450);
}

async function humanMouseMove(page) {
  const viewport = page.viewportSize() || { width: 1366, height: 768 };
  const width = Math.max(320, viewport.width || 1366);
  const height = Math.max(320, viewport.height || 768);

  for (let index = 0; index < 1 + Math.floor(Math.random() * 2); index += 1) {
    const x = 80 + Math.floor(Math.random() * Math.max(width - 160, 120));
    const y = 80 + Math.floor(Math.random() * Math.max(height - 160, 120));
    await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 8) }).catch(() => {});
    await randomDelay(90, 260);
  }
}

async function humanScroll(page) {
  await page.evaluate(() => window.scrollBy(0, 60 + Math.random() * 180)).catch(() => {});
  await randomDelay(120, 320);
  await page.evaluate(() => window.scrollBy(0, -30 - Math.random() * 90)).catch(() => {});
  await randomDelay(100, 260);
}

async function fillAndVerify(locator, expectedValue) {
  const expected = String(expectedValue);
  await locator.focus({ timeout: 10000 });
  await randomDelay(120, 320);
  await locator.fill(expected, { timeout: 10000 });
  await locator.dispatchEvent("input").catch(() => {});
  await locator.dispatchEvent("change").catch(() => {});
  await randomDelay(120, 280);

  let actual = await locator.inputValue({ timeout: 5000 }).catch(() => "");

  if (actual === expected) {
    return;
  }

  await locator.focus({ timeout: 5000 });
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
  await locator.press("Backspace").catch(() => {});
  await randomDelay(120, 300);
  await locator.fill(expected, { timeout: 10000 });
  await locator.dispatchEvent("input").catch(() => {});
  await locator.dispatchEvent("change").catch(() => {});
  actual = await locator.inputValue({ timeout: 5000 }).catch(() => "");

  if (actual !== expected) {
    throw new Error(`Input value mismatch after fill. Expected ${expected.length} chars, got ${actual.length} chars`);
  }
}

async function clickNext(page, preferredSelector = "") {
  if (preferredSelector) {
    const preferred = page.locator(preferredSelector).first();
    if (await preferred.isVisible({ timeout: 5000 }).catch(() => false)) {
      await humanMouseMove(page);
      await preferred.click({ timeout: 10000 });
      return;
    }
  }

  const selectorCandidates = [
    "button:has-text('Next')",
    "button:has-text('Sonraki')",
    "div[role='button']:has-text('Next')",
    "div[role='button']:has-text('Sonraki')"
  ];

  for (const selector of selectorCandidates) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 1200 }).catch(() => false)) {
      await humanMouseMove(page);
      await button.click({ timeout: 10000 });
      return;
    }
  }

  const nextButton = page.getByRole("button", { name: /Sonraki|Next/i }).first();
  if (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanMouseMove(page);
    await nextButton.click({ timeout: 10000 });
    return;
  }

  await page.keyboard.press("Enter");
}

async function dismissOptionalPrompts(page) {
  const buttons = [
    /Şimdi değil|Not now/i,
    /Atla|Skip/i,
    /Devam|Continue/i,
    /I agree|Kabul ediyorum/i
  ];

  for (const pattern of buttons) {
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.isVisible({ timeout: 1200 }).catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => {});
      await randomDelay(500, 1200);
    }
  }
}

async function waitForVisibleSelector(page, selectors, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
        return { selector, locator };
      }
    }
    await delay(500);
  }

  return null;
}

async function chooseTotpChallengeIfNeeded(page) {
  const totpSelector = "input#totpPin, input[name='totpPin'], input[autocomplete='one-time-code'], input[type='tel']";
  if (await page.locator(totpSelector).first().isVisible({ timeout: 1500 }).catch(() => false)) {
    return;
  }

  const optionPatterns = [
    /Başka bir yöntem dene|Try another way/i,
    /Google Authenticator/i,
    /Authenticator/i,
    /Doğrulama kodu|verification code/i,
    /Telefonunuzdaki Google uygulamasından kod alın|Get a verification code/i
  ];

  for (const pattern of optionPatterns) {
    const candidate = page.getByText(pattern).first();
    if (await candidate.isVisible({ timeout: 1200 }).catch(() => false)) {
      await humanMouseMove(page);
      await candidate.click({ timeout: 8000 }).catch(() => {});
      await randomDelay(650, 1400);
      if (await page.locator(totpSelector).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        return;
      }
    }
  }
}

async function handleTwoFactorChallenge(page, twoFaSecret, onEvent = async () => {}) {
  const challenge = await detectTwoFactorChallenge(page);
  if (!challenge) {
    return { success: true, handled: false };
  }
  await onEvent("google_auth_2fa_challenge_detected", { url: challenge.url, reason: challenge.reason });

  if (!normalizeTwoFaSecret(twoFaSecret)) {
    return { success: false, error: "two_fa_secret_missing", failureReason: "2fa_challenge", url: challenge.url };
  }

  const totpSelector = "input#totpPin, input[name='totpPin'], input[autocomplete='one-time-code'], input[type='tel']";
  await chooseTotpChallengeIfNeeded(page);
  await page.waitForSelector(totpSelector, { state: "visible", timeout: 30000 });

  // Wrong TOTP codes happen "sometimes" because of window-boundary staleness, so generate a fresh
  // window-safe code per attempt and retry if Google rejects it. Every step is logged.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (page.isClosed()) break;

    const codeResult = await generateTotpWindowSafe(twoFaSecret, onEvent);
    if (!codeResult.success) {
      await onEvent("google_auth_2fa_code_failed", { attempt, error: codeResult.error });
      return { success: false, error: codeResult.error, failureReason: "2fa_challenge", url: page.url() };
    }
    await onEvent("google_auth_2fa_code_generated", {
      attempt,
      codeMasked: `${codeResult.code.slice(0, 2)}****`,
      secondsRemaining: codeResult.secondsRemaining
    });

    const input = page.locator(totpSelector).first();
    await input.fill("").catch(() => {});
    await fillAndVerify(input, codeResult.code);
    await onEvent("google_auth_2fa_code_filled", { attempt });
    await clickNext(page);
    await onEvent("google_auth_2fa_submitted", { attempt });
    await page.waitForLoadState("domcontentloaded", { timeout: taskTimeoutMs }).catch(() => {});
    await randomDelay(1200, 2200);

    const stillOn2fa = !page.isClosed() && Boolean(await detectTwoFactorChallenge(page));
    const wrongCode = stillOn2fa ? await detectWrongTotpCode(page) : false;
    await onEvent("google_auth_2fa_result", {
      attempt,
      stillOn2fa,
      wrongCode,
      url: page.isClosed() ? "" : page.url()
    });

    if (!stillOn2fa) {
      await dismissOptionalPrompts(page);
      return { success: true, handled: true };
    }
    // Still blocked on the 2FA page → loop and submit a fresh window-safe code.
  }

  return {
    success: false,
    error: "two_fa_wrong_code",
    failureReason: "2fa_challenge",
    url: page.isClosed() ? challenge.url : page.url()
  };
}

async function attemptAutomatedRecaptcha(page, email, captchaApiKey, onEvent) {
  if (!hasApiKey(captchaApiKey)) {
    return { solved: false, attempted: false };
  }

  const urlBeforeSolve = page.url();
  const solve = await solveRecaptchaOnPage(page, { apiKey: captchaApiKey, onEvent });
  if (!solve.success) {
    return { solved: false, attempted: !solve.skipped, error: solve.error };
  }

  // Invisible reCAPTCHA auto-submits via callback; checkbox variants need the Next button.
  await onEvent("google_auth_captcha_submit_started", { email, url: urlBeforeSolve });
  if (await detectRecaptchaChallenge(page)) {
    await clickNext(page).catch(() => {});
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await randomDelay(1500, 2600);

  const urlAfterSubmit = page.isClosed() ? "" : page.url();
  const stillBlocked = !page.isClosed() && Boolean(await detectRecaptchaChallenge(page));
  await onEvent("google_auth_captcha_submit_result", {
    email,
    urlBefore: urlBeforeSolve,
    urlAfter: urlAfterSubmit,
    urlChanged: urlAfterSubmit !== urlBeforeSolve,
    stillBlocked
  });

  if (page.isClosed() || !stillBlocked) {
    await onEvent("google_auth_recaptcha_completed", { email, url: urlAfterSubmit, via: "2captcha" });
    return { solved: true, attempted: true };
  }

  return { solved: false, attempted: true, error: "recaptcha_still_present_after_solve" };
}

async function waitForManualRecaptchaIfNeeded(page, headless, email, captchaApiKey, onEvent, timeout = 180000) {
  const challenge = await detectRecaptchaChallenge(page);
  if (!challenge) {
    return { success: true, handled: false };
  }

  await onEvent("google_auth_recaptcha_required", { email, url: challenge.url, headless, hasApiKey: hasApiKey(captchaApiKey) });

  // 2captcha anahtarı varsa: DAİMA servise gidip çöz. Birkaç deneme yap, kullanıcıyı asla manuel
  // çözüme bekletme (headless olsun olmasın).
  if (hasApiKey(captchaApiKey)) {
    const maxSolveAttempts = 2;
    for (let attempt = 1; attempt <= maxSolveAttempts; attempt += 1) {
      if (page.isClosed()) break;
      if (!(await detectRecaptchaChallenge(page))) {
        return { success: true, handled: true };
      }
      const automated = await attemptAutomatedRecaptcha(page, email, captchaApiKey, onEvent);
      if (automated.solved) {
        return { success: true, handled: true };
      }
      await onEvent("google_auth_captcha_attempt_failed", { email, attempt, maxSolveAttempts, error: automated.error });
    }
    return {
      success: false,
      error: "google_recaptcha_unsolved",
      failureReason: "recaptcha_challenge",
      url: page.isClosed() ? challenge.url : page.url()
    };
  }

  // Anahtar yoksa eski davranış: headless'ta hemen fail, görünür modda manuel bekleme.
  if (headless) {
    return {
      success: false,
      error: "google_recaptcha_required",
      failureReason: "recaptcha_challenge",
      url: page.isClosed() ? challenge.url : page.url()
    };
  }

  const start = Date.now();
  while (Date.now() - start < timeout) {
    await delay(1500);
    if (page.isClosed()) {
      return {
        success: false,
        error: "google_recaptcha_browser_closed",
        failureReason: "recaptcha_challenge",
        url: challenge.url
      };
    }

    const stillBlocked = await detectRecaptchaChallenge(page);
    if (!stillBlocked) {
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      await onEvent("google_auth_recaptcha_completed", { email, url: page.url() });
      return { success: true, handled: true };
    }
  }

  return {
    success: false,
    error: "google_recaptcha_required",
    failureReason: "recaptcha_challenge",
    url: page.url()
  };
}

function toCookiePayload(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || "/",
    expires: cookie.expires,
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    sameSite: cookie.sameSite
  };
}

function filterGoogleCookies(cookies) {
  return cookies
    .filter((cookie) => /(^|\.)google\.com$|(^|\.)accounts\.google\.com$|(^|\.)mail\.google\.com$/.test(cookie.domain || ""))
    .filter((cookie) => cookie.name && typeof cookie.value !== "undefined")
    .map(toCookiePayload);
}

async function generateGoogleAuthCookies({ email, password, twoFaSecret, headless, deviceMode, proxyUrl, captchaApiKey = "", onEvent = async () => {} }) {
  const context = await launchBrowserContext({ headless, deviceMode, proxyUrl });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(taskTimeoutMs);
    page.setDefaultNavigationTimeout(taskTimeoutMs);

    await onEvent("google_auth_context_started", { email, hasProxy: Boolean(proxyUrl) });
    await page.goto(DEFAULT_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: taskTimeoutMs });
    await randomDelay(700, 1400);
    await humanMouseMove(page);
    await humanScroll(page);

    const unsafeInitial = await detectUnsafeBrowser(page);
    if (unsafeInitial) {
      await onEvent("google_auth_unsafe_browser", { email, url: unsafeInitial.url });
      return { success: false, error: "google_unsafe_browser", failureReason: "unsafe_browser", url: unsafeInitial.url };
    }

    const emailSelector = "input[type='email'], input[name='identifier'], input[autocomplete='username']";
    if (await page.locator(emailSelector).first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await onEvent("google_auth_email_step_started", { email });
      await fillAndVerify(page.locator(emailSelector).first(), email);
      await onEvent("google_auth_email_step_completed", { email });
      await clickNext(page, "#identifierNext");
      await page.waitForLoadState("domcontentloaded", { timeout: taskTimeoutMs }).catch(() => {});
      await randomDelay(900, 1800);

      const unsafeAfterEmail = await detectUnsafeBrowser(page);
      if (unsafeAfterEmail) {
        await onEvent("google_auth_unsafe_browser", { email, url: unsafeAfterEmail.url });
        return { success: false, error: "google_unsafe_browser", failureReason: "unsafe_browser", url: unsafeAfterEmail.url };
      }

      const recaptchaAfterEmail = await waitForManualRecaptchaIfNeeded(page, headless, email, captchaApiKey, onEvent);
      if (!recaptchaAfterEmail.success) {
        return recaptchaAfterEmail;
      }
    }

    const passwordSelector = "input[type='password'][name='Passwd'], input[autocomplete='current-password']";
    const passwordStep = await waitForVisibleSelector(page, [passwordSelector], 30000);
    if (passwordStep) {
      await onEvent("google_auth_password_step_started", { email });
      await humanMouseMove(page);
      await humanScroll(page);
      await fillAndVerify(passwordStep.locator, password);
      await onEvent("google_auth_password_step_completed", { email });
      await clickNext(page, "#passwordNext");
      await page.waitForLoadState("domcontentloaded", { timeout: taskTimeoutMs }).catch(() => {});
      await randomDelay(900, 2200);
    } else if (await page.locator(emailSelector).first().isVisible({ timeout: 1000 }).catch(() => false)) {
      return { success: false, error: "google_email_step_not_advanced", url: page.url() };
    }

    const unsafeAfterPassword = await detectUnsafeBrowser(page);
    if (unsafeAfterPassword) {
      await onEvent("google_auth_unsafe_browser", { email, url: unsafeAfterPassword.url });
      return { success: false, error: "google_unsafe_browser", failureReason: "unsafe_browser", url: unsafeAfterPassword.url };
    }

    const recaptchaAfterPassword = await waitForManualRecaptchaIfNeeded(page, headless, email, captchaApiKey, onEvent);
    if (!recaptchaAfterPassword.success) {
      return recaptchaAfterPassword;
    }

    const twoFaResult = await handleTwoFactorChallenge(page, twoFaSecret, onEvent);
    if (!twoFaResult.success) {
      await onEvent("google_auth_2fa_failed", { email, error: twoFaResult.error, url: twoFaResult.url });
      return twoFaResult;
    }

    await dismissOptionalPrompts(page);
    const recaptchaAfterTwoFa = await waitForManualRecaptchaIfNeeded(page, headless, email, captchaApiKey, onEvent);
    if (!recaptchaAfterTwoFa.success) {
      return recaptchaAfterTwoFa;
    }

    await page.goto("https://myaccount.google.com/", { waitUntil: "domcontentloaded", timeout: taskTimeoutMs }).catch(() => {});
    await randomDelay(700, 1400);

    const cookies = filterGoogleCookies(await context.cookies(GOOGLE_COOKIE_URLS));
    await onEvent("google_auth_cookies_collected", { email, cookieCount: cookies.length, url: page.url() });

    if (!cookies.length) {
      return { success: false, error: "google_cookies_not_found", url: page.url() };
    }

    return {
      success: true,
      url: page.url(),
      cookies
    };
  } catch (error) {
    await onEvent("google_auth_failed", { email, error: error.message });
    return { success: false, error: error.message || "google_auth_failed" };
  } finally {
    await context.close();
  }
}

module.exports = {
  generateGoogleAuthCookies,
  generateTotp,
  normalizeTwoFaSecret
};
