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

// Google telefon (SMS) doğrulama duvarı: /signin/challenge/iap (identity assurance phone),
// /challenge/ipp, /challenge/dp. Bu, hesabın yüksek riskli işaretlendiğini (pratikte yandığını) gösterir.
function isPhoneChallengeUrl(url = "") {
  return /accounts\.google\.com\/.*signin\/challenge\/(iap|ipp|dp)\b/i.test(url);
}

function isTwoFactorChallengeUrl(url = "") {
  return /accounts\.google\.com\/.*signin\/challenge/i.test(url)
    && !isRecaptchaChallengeUrl(url)
    && !isPhoneChallengeUrl(url);
}

// Telefon doğrulama challenge'ını URL veya metinden tespit eder. iap URL'i 2FA URL desenine de
// uyduğu için ÖNCE bunu kontrol etmek gerekir; aksi halde TOTP kodu telefon alanına yazılmaya çalışılır.
async function detectPhoneVerificationChallenge(page) {
  const url = page.url();
  if (isPhoneChallengeUrl(url)) {
    return { reason: "phone_url", url };
  }

  const textCandidates = [
    "Enter a phone number to get a text message",
    "get a text message with a verification code",
    "There is something unusual about your activity",
    "Telefon numarası girin",
    "doğrulama kodu içeren bir kısa mesaj"
  ];

  for (const text of textCandidates) {
    const visible = await page.getByText(text, { exact: false }).first().isVisible({ timeout: 800 }).catch(() => false);
    if (visible) {
      return { reason: "phone_text", url, text };
    }
  }

  return null;
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

const TYPO_NEIGHBORS = {
  a: "sq", e: "wr", i: "ou", o: "ip", u: "yi", r: "et", s: "ad", t: "ry",
  n: "mb", l: "ko", c: "xv", d: "sf", m: "n", g: "fh", h: "gj"
};

// İnsan gibi yazar: değişken tuş gecikmesi + ara sıra (~%8) komşu-tuş typo'su yapıp backspace ile
// düzeltir. Şifre/2FA gibi alanlarda da çalışır; düzeltme yaptığı için sonuç metni doğru kalır.
async function humanType(locator, text) {
  await locator.focus({ timeout: 10000 });
  await randomDelay(180, 450);

  const chars = String(text);
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    // ~%8 ihtimalle önce yanlış (komşu) harf yaz, sonra sil — gerçek typo davranışı.
    const lower = char.toLowerCase();
    if (TYPO_NEIGHBORS[lower] && Math.random() < 0.08) {
      const neighbors = TYPO_NEIGHBORS[lower];
      const wrong = neighbors[Math.floor(Math.random() * neighbors.length)];
      await locator.type(char === char.toUpperCase() && char !== lower ? wrong.toUpperCase() : wrong, { delay: 30 + Math.floor(Math.random() * 60) });
      await randomDelay(120, 360); // typo'yu fark etme süresi
      await locator.press("Backspace").catch(() => {});
      await randomDelay(90, 240);
    }
    await locator.type(char, { delay: 30 + Math.floor(Math.random() * 70) });
    if (Math.random() < 0.12) await randomDelay(150, 500); // arada düşünme molası
  }

  await randomDelay(180, 450);
}

// İnsan eli düz gitmez; her hedefe 2-3 ara nokta üzerinden eğri çizerek, değişken hızla gider ve
// arada kısa duraklar. CloakBrowser humanize'ı destekler ama biz de gerçek mouse event'leri üretiyoruz.
async function humanMouseMove(page, moves = 2 + Math.floor(Math.random() * 4)) {
  const viewport = page.viewportSize() || { width: 1280, height: 800 };
  const width = Math.max(320, viewport.width || 1280);
  const height = Math.max(320, viewport.height || 800);
  let cx = 80 + Math.random() * (width - 160);
  let cy = 80 + Math.random() * (height - 160);

  for (let i = 0; i < moves; i += 1) {
    const tx = 60 + Math.random() * (width - 120);
    const ty = 60 + Math.random() * (height - 120);
    // 2-3 ara nokta üzerinden eğri (bezier benzeri) yol.
    const waypoints = 2 + Math.floor(Math.random() * 2);
    for (let w = 1; w <= waypoints; w += 1) {
      const t = w / waypoints;
      const jitterX = (Math.random() - 0.5) * 80;
      const jitterY = (Math.random() - 0.5) * 80;
      const px = cx + (tx - cx) * t + jitterX;
      const py = cy + (ty - cy) * t + jitterY;
      await page.mouse.move(px, py, { steps: 6 + Math.floor(Math.random() * 12) }).catch(() => {});
      await randomDelay(40, 140);
    }
    cx = tx; cy = ty;
    if (Math.random() < 0.4) await randomDelay(200, 700); // arada düşünme molası
  }
}

// Bir öğeye mouse'u götürüp (hover) kısa bekleyip tıklar — direkt programatik click yerine insan gibi.
async function humanHoverClick(page, locator) {
  try {
    const box = await locator.boundingBox({ timeout: 5000 });
    if (box) {
      const tx = box.x + box.width * (0.3 + Math.random() * 0.4);
      const ty = box.y + box.height * (0.3 + Math.random() * 0.4);
      await page.mouse.move(tx, ty, { steps: 8 + Math.floor(Math.random() * 14) }).catch(() => {});
      await randomDelay(120, 380);
      await page.mouse.down().catch(() => {});
      await randomDelay(40, 110);
      await page.mouse.up().catch(() => {});
      return true;
    }
  } catch (error) { /* fall back to locator click */ }
  await locator.click({ timeout: 8000 }).catch(() => {});
  return false;
}

async function humanScroll(page, rounds = 1 + Math.floor(Math.random() * 3)) {
  for (let i = 0; i < rounds; i += 1) {
    const down = 120 + Math.random() * 360;
    await page.mouse.wheel(0, down).catch(() => page.evaluate((d) => window.scrollBy(0, d), down).catch(() => {}));
    await randomDelay(350, 1100);
    if (Math.random() < 0.35) {
      await page.mouse.wheel(0, -(40 + Math.random() * 120)).catch(() => {});
      await randomDelay(250, 700);
    }
  }
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

// Returns { clicked, via } so callers can log whether the Next button was actually pressed.
async function clickNext(page, preferredSelector = "") {
  if (preferredSelector) {
    const preferred = page.locator(preferredSelector).first();
    if (await preferred.isVisible({ timeout: 5000 }).catch(() => false)) {
      await humanMouseMove(page);
      await preferred.click({ timeout: 10000 });
      return { clicked: true, via: preferredSelector };
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
      return { clicked: true, via: selector };
    }
  }

  const nextButton = page.getByRole("button", { name: /Sonraki|Next/i }).first();
  if (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanMouseMove(page);
    await nextButton.click({ timeout: 10000 });
    return { clicked: true, via: "role=button[name=Next]" };
  }

  await page.keyboard.press("Enter");
  return { clicked: false, via: "enter-fallback" };
}

async function submitRecaptchaForm(page) {
  return page.evaluate(() => {
    const textarea = document.querySelector('textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
    const form = textarea
      ? textarea.closest("form")
      : Array.from(document.forms).find((candidate) => candidate.querySelector('textarea[name="g-recaptcha-response"]'));

    if (!form) {
      return { submitted: false, via: "no-form" };
    }

    const tokenLength = textarea ? (textarea.value || "").length : 0;
    if (!tokenLength) {
      return { submitted: false, via: "token-empty", tokenLength };
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    const submitter = form.querySelector('button[type="submit"], input[type="submit"]');
    if (typeof form.requestSubmit === "function") {
      if (submitter) {
        form.requestSubmit(submitter);
      } else {
        form.requestSubmit();
      }
      return {
        submitted: true,
        via: submitter ? "form.requestSubmit(submitter)" : "form.requestSubmit()",
        tokenLength,
        action: form.getAttribute("action") || "",
        method: form.getAttribute("method") || ""
      };
    }

    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    const notCancelled = form.dispatchEvent(submitEvent);
    if (notCancelled && typeof form.submit === "function") {
      form.submit();
      return {
        submitted: true,
        via: "form.submit()",
        tokenLength,
        action: form.getAttribute("action") || "",
        method: form.getAttribute("method") || ""
      };
    }

    return { submitted: false, via: "submit-event-cancelled", tokenLength };
  }).catch((error) => ({ submitted: false, via: "error", error: error.message }));
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

async function attemptAutomatedRecaptcha(page, email, captchaApiKey, onEvent, proxyUrl = "") {
  if (!hasApiKey(captchaApiKey)) {
    return { solved: false, attempted: false };
  }

  const urlBeforeSolve = page.url();
  const solve = await solveRecaptchaOnPage(page, { apiKey: captchaApiKey, onEvent, proxyUrl });
  if (!solve.success) {
    return { solved: false, attempted: !solve.skipped, error: solve.error };
  }

  // Invisible reCAPTCHA auto-submits via callback; checkbox variants need the Next button. Give the
  // widget a moment to bind the injected token into the form (checkbox turns green) before submit.
  await randomDelay(1200, 2000);
  const tokenBound = await readRecaptchaTokenBinding(page);
  await onEvent("google_auth_captcha_submit_started", { email, url: urlBeforeSolve, tokenBound });

  const formSubmitResult = await submitRecaptchaForm(page);
  await onEvent("google_auth_captcha_form_submit", { email, ...formSubmitResult });
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await randomDelay(1500, 2600);

  let stillBlocked = !page.isClosed() && Boolean(await detectRecaptchaChallenge(page));
  let nextResult = { clicked: false, via: "skipped_after_form_submit" };
  if (stillBlocked) {
    nextResult = await clickNext(page).catch((error) => ({ clicked: false, via: "error", error: error.message }));
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await randomDelay(1500, 2600);
    stillBlocked = !page.isClosed() && Boolean(await detectRecaptchaChallenge(page));
  }
  await onEvent("google_auth_captcha_next_clicked", { email, ...nextResult });

  const urlAfterSubmit = page.isClosed() ? "" : page.url();
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

async function readRecaptchaTokenBinding(page) {
  return page.evaluate(() => {
    const ta = document.querySelector('textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
    let getResponseLen = 0;
    try {
      getResponseLen = (window.grecaptcha && window.grecaptcha.getResponse && window.grecaptcha.getResponse() || "").length;
    } catch (e) {}
    return { textareaLen: ta ? (ta.value || "").length : 0, getResponseLen };
  }).catch(() => ({ textareaLen: 0, getResponseLen: 0 }));
}

function hasRecaptchaToken(tokenBound = {}) {
  return Number(tokenBound.textareaLen || 0) > 0 || Number(tokenBound.getResponseLen || 0) > 0;
}

async function waitForManualRecaptchaIfNeeded(page, headless, email, captchaApiKey, onEvent, timeout = 180000, proxyUrl = "") {
  const challenge = await detectRecaptchaChallenge(page);
  if (!challenge) {
    return { success: true, handled: false };
  }

  await onEvent("google_auth_recaptcha_required", { email, url: challenge.url, headless, hasApiKey: hasApiKey(captchaApiKey) });

  // SADECE HEADLESS'ta 2captcha'ya git (insan yok). GÖRÜNÜR modda 2captcha çalıştırma — signin'de
  // zaten Google reddediyor + ekranda insan var; aşağıdaki manuel-bekleme döngüsü, kullanıcı captcha'yı
  // elle çözünce captcha temizlenir temizlenmez ANINDA devam eder (şifre adımına geçer).
  if (headless && hasApiKey(captchaApiKey)) {
    const maxSolveAttempts = 2;
    for (let attempt = 1; attempt <= maxSolveAttempts; attempt += 1) {
      if (page.isClosed()) break;
      if (!(await detectRecaptchaChallenge(page))) {
        return { success: true, handled: true };
      }
      const automated = await attemptAutomatedRecaptcha(page, email, captchaApiKey, onEvent, proxyUrl);
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

  // Headless'ta insan yok → hemen fail. Görünür modda kullanıcı captcha'yı elle çözene kadar bekle.
  if (headless) {
    return {
      success: false,
      error: "google_recaptcha_required",
      failureReason: "recaptcha_challenge",
      url: page.isClosed() ? challenge.url : page.url()
    };
  }

  // Görünür mod: captcha'yı ELLE ÇÖZ. Captcha temizlenir temizlenmez (her ~1.5sn kontrol) devam eder.
  const manualTimeout = Math.max(timeout, 300000);
  await onEvent("google_auth_recaptcha_manual_wait", { email, url: challenge.url, timeoutMs: manualTimeout });
  const start = Date.now();
  while (Date.now() - start < manualTimeout) {
    await delay(1500);
    if (page.isClosed()) {
      return {
        success: false,
        error: "google_recaptcha_browser_closed",
        failureReason: "recaptcha_challenge",
        url: challenge.url
      };
    }

    const tokenBound = await readRecaptchaTokenBinding(page);
    if (hasRecaptchaToken(tokenBound)) {
      await onEvent("google_auth_recaptcha_manual_token_detected", { email, url: page.url(), tokenBound });
      const formSubmitResult = await submitRecaptchaForm(page);
      await onEvent("google_auth_captcha_form_submit", { email, ...formSubmitResult, viaManual: true });
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await randomDelay(1500, 2600);

      let stillBlockedAfterSubmit = !page.isClosed() && Boolean(await detectRecaptchaChallenge(page));
      let nextResult = { clicked: false, via: "skipped_after_form_submit" };
      if (stillBlockedAfterSubmit) {
        nextResult = await clickNext(page).catch((error) => ({ clicked: false, via: "error", error: error.message }));
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await randomDelay(1500, 2600);
        stillBlockedAfterSubmit = !page.isClosed() && Boolean(await detectRecaptchaChallenge(page));
      }
      await onEvent("google_auth_captcha_next_clicked", { email, ...nextResult, viaManual: true });

      await onEvent("google_auth_captcha_submit_result", {
        email,
        urlBefore: challenge.url,
        urlAfter: page.isClosed() ? "" : page.url(),
        urlChanged: !page.isClosed() && page.url() !== challenge.url,
        stillBlocked: stillBlockedAfterSubmit,
        via: "manual"
      });

      if (page.isClosed() || !stillBlockedAfterSubmit) {
        await onEvent("google_auth_recaptcha_completed", { email, url: page.isClosed() ? "" : page.url(), via: "manual" });
        return { success: true, handled: true };
      }
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

// Google/YouTube EU consent wall blocks warm-up navigation; dismiss it (any frame) if present.
async function dismissGoogleConsent(page) {
  const labels = ["Reject all", "Tümünü reddet", "Accept all", "Tümünü kabul et", "I agree", "Kabul ediyorum"];
  for (const frame of page.frames()) {
    for (const label of labels) {
      const button = frame.locator(`button:has-text("${label}"), [role="button"]:has-text("${label}")`).first();
      if (await button.isVisible({ timeout: 700 }).catch(() => false)) {
        await button.click({ timeout: 2000 }).catch(() => {});
        await randomDelay(500, 1200);
        return true;
      }
    }
  }
  return false;
}

const WARMUP_QUERIES = ["hava durumu", "euro kaç tl", "bugün maçlar", "haberler", "sinema vizyon", "dolar kuru"];

// Warms the proxy IP + browser session BEFORE the signin form. A fresh mobile IP that jumps straight
// to accounts.google.com with zero prior Google cookies looks bot-like → Google throws the
// "Verify it's you" reCAPTCHA (which 2captcha cannot reliably solve on Google's own enterprise
// challenge). Browsing Google + running a benign search + visiting YouTube first (human-paced) earns
// NID/CONSENT cookies and gives the IP legitimate traffic, dropping the signin risk score so the
// captcha usually never appears. Best-effort: never throws, never blocks login on failure.
// Disable with GAUTH_WARMUP=0.
// google.com/sorry/index — Google Search'ün "unusual traffic" reCAPTCHA'sı. Signin'in çözülemeyen
// enterprise image challenge'ından FARKLI: data-sitekey + data-s'li klasik checkbox; 2captcha'nın
// tam desteklediği senaryo. Çözmek hem warmup'ı tamamlar hem IP'nin "unusual traffic" bloğunu
// kaldırır → sonraki signin'e yardım eder.
function isGoogleSorryUrl(url = "") {
  return /google\.[^/]+\/sorry\//i.test(url);
}

async function solveGoogleSorryIfPresent(page, { captchaApiKey, proxyUrl, onEvent }) {
  if (page.isClosed() || !isGoogleSorryUrl(page.url())) {
    return false;
  }
  await onEvent("google_auth_search_captcha_detected", { url: page.url() });
  if (!hasApiKey(captchaApiKey)) {
    await onEvent("google_auth_search_captcha_skipped", { reason: "captcha_api_key_missing" });
    return false;
  }
  const solve = await solveRecaptchaOnPage(page, { apiKey: captchaApiKey, onEvent, proxyUrl });
  if (!solve.success) {
    await onEvent("google_auth_search_captcha_failed", { error: solve.error });
    return false;
  }
  // submitCallback token enjekte edilip callback tetiklenince formu submit eder → /sorry'den çıkar.
  await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
  await randomDelay(1500, 2800);
  const cleared = !isGoogleSorryUrl(page.url());
  await onEvent("google_auth_search_captcha_result", { cleared, url: page.isClosed() ? "" : page.url() });
  return cleared;
}

// Arama sonuç sayfasındaki ilk organik (reklam olmayan) sonuca insan gibi tıklayıp hedef sitede gezer,
// sonra geri döner. Gerçek tarama davranışı + cookie/history birikimi sağlar.
async function clickOrganicResultAndBrowse(page, onEvent) {
  try {
    const link = page.locator("#search a:has(h3), #rso a:has(h3)").first();
    if (!(await link.isVisible({ timeout: 4000 }).catch(() => false))) return false;
    await humanMouseMove(page, 2);
    await humanHoverClick(page, link);
    await page.waitForLoadState("domcontentloaded", { timeout: 25000 }).catch(() => {});
    await randomDelay(2000, 4000);
    await humanMouseMove(page, 3);
    await humanScroll(page, 2 + Math.floor(Math.random() * 3));
    await randomDelay(2000, 5000); // sayfada okuma süresi
    await onEvent("google_auth_warmup_visited", { url: (page.url() || "").slice(0, 80) });
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await randomDelay(1200, 2600);
    return true;
  } catch (error) {
    return false;
  }
}

async function warmUpSession(page, onEvent = async () => {}, { captchaApiKey = "", proxyUrl = "" } = {}) {
  const steps = [];
  const solveSorry = () => solveGoogleSorryIfPresent(page, { captchaApiKey, proxyUrl, onEvent }).catch(() => false);
  try {
    await onEvent("google_auth_warmup_started", {});

    await page.goto("https://www.google.com/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await randomDelay(1500, 3000);
    await dismissGoogleConsent(page);
    await solveSorry();
    await humanMouseMove(page, 3);
    await humanScroll(page);
    await randomDelay(1500, 3000);
    steps.push("google");

    // 1-2 doğal arama + sonuç tıklama + sitede gezinme.
    const searchRounds = 1 + Math.floor(Math.random() * 2);
    for (let round = 0; round < searchRounds; round += 1) {
      const searchBox = page.locator("textarea[name='q'], input[name='q']").first();
      if (!(await searchBox.isVisible({ timeout: 4000 }).catch(() => false))) break;
      const query = WARMUP_QUERIES[Math.floor(Math.random() * WARMUP_QUERIES.length)];
      await humanHoverClick(page, searchBox);
      await humanType(searchBox, query);
      await randomDelay(400, 1100);
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
      await randomDelay(1500, 3000);
      // "unusual traffic" /sorry captcha'sı genelde tam burada çıkar; 2captcha ile çöz.
      await solveSorry();
      await humanMouseMove(page, 2);
      await humanScroll(page, 2);
      // Sonuca tıklayıp gerçek sitede gez (ilk roundda daha olası).
      if (Math.random() < 0.8) await clickOrganicResultAndBrowse(page, onEvent);
      await randomDelay(1200, 2600);
      steps.push("search");
    }

    await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await randomDelay(1500, 3000);
    await dismissGoogleConsent(page);
    await solveSorry();
    await humanMouseMove(page, 3);
    await humanScroll(page, 2 + Math.floor(Math.random() * 2));
    await randomDelay(2000, 4000);
    steps.push("youtube");

    await onEvent("google_auth_warmup_completed", { steps });
  } catch (error) {
    await onEvent("google_auth_warmup_failed", { error: error.message, steps });
  }
}

async function generateGoogleAuthCookies({ email, password, twoFaSecret, headless, deviceMode, proxyUrl, captchaApiKey = "", profileKey = "", onEvent = async () => {} }) {
  const context = await launchBrowserContext({ headless, deviceMode, proxyUrl, profileKey });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(taskTimeoutMs);
    page.setDefaultNavigationTimeout(taskTimeoutMs);

    await onEvent("google_auth_context_started", { email, hasProxy: Boolean(proxyUrl) });

    // Warm the proxy IP + session before signin so Google doesn't flag the flow and throw the
    // unsolvable enterprise reCAPTCHA. Disable with GAUTH_WARMUP=0.
    if (process.env.GAUTH_WARMUP !== "0") {
      await warmUpSession(page, onEvent, { captchaApiKey, proxyUrl });
    }

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

      const recaptchaAfterEmail = await waitForManualRecaptchaIfNeeded(page, headless, email, captchaApiKey, onEvent, undefined, proxyUrl);
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

    const recaptchaAfterPassword = await waitForManualRecaptchaIfNeeded(page, headless, email, captchaApiKey, onEvent, undefined, proxyUrl);
    if (!recaptchaAfterPassword.success) {
      return recaptchaAfterPassword;
    }

    // Telefon (SMS) doğrulama duvarı: hesap yüksek riskli işaretlenmiş, otomasyonla geçilemez.
    // 2FA kontrolünden ÖNCE bakılır (iap URL'i 2FA desenine de uyar).
    const phoneChallenge = await detectPhoneVerificationChallenge(page);
    if (phoneChallenge) {
      await onEvent("google_auth_phone_verification_required", { email, url: phoneChallenge.url, reason: phoneChallenge.reason });
      return {
        success: false,
        error: "google_phone_verification_required",
        failureReason: "phone_verification",
        url: phoneChallenge.url
      };
    }

    const twoFaResult = await handleTwoFactorChallenge(page, twoFaSecret, onEvent);
    if (!twoFaResult.success) {
      await onEvent("google_auth_2fa_failed", { email, error: twoFaResult.error, url: twoFaResult.url });
      return twoFaResult;
    }

    await dismissOptionalPrompts(page);
    const recaptchaAfterTwoFa = await waitForManualRecaptchaIfNeeded(page, headless, email, captchaApiKey, onEvent, undefined, proxyUrl);
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
  normalizeTwoFaSecret,
  warmUpSession,
  humanType,
  humanMouseMove,
  humanHoverClick,
  humanScroll,
  clickNext,
  randomDelay,
  delay,
  detectRecaptchaChallenge,
  waitForManualRecaptchaIfNeeded
};
