const { launchBrowserContext } = require("./cloakBrowserClient");
const {
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
} = require("./googleAuthLogin");
const { generateUsername } = require("../Domain/gmailSignupIdentity");

const SIGNUP_URL = "https://accounts.google.com/signup/v2/webcreateaccount?flowName=GlifWebSignIn&flowEntry=SignUp";
const MANUAL_TIMEOUT_MS = Number(process.env.GMAIL_CREATOR_TIMEOUT_MS || 600000);
const NAV_TIMEOUT_MS = Number(process.env.GMAIL_CREATOR_NAV_TIMEOUT_MS || 120000);

function isSignupSuccessUrl(url = "") {
  return /myaccount\.google\.com|mail\.google\.com|accounts\.google\.com\/AccountChooser|accounts\.google\.com\/signin\/v2\/challenge\/done/i.test(url);
}

async function visibleFirst(page, selectors, timeout = 8000) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: Math.min(timeout, 3000) }).catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function clickNextButton(page) {
  const clicked = await clickNext(page);
  if (clicked.clicked) return true;

  const labels = ["Next", "İleri", "Sonraki", "I agree", "Kabul ediyorum", "Kabul Et"];
  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(label, "i") }).first();
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      await humanHoverClick(page, button);
      return true;
    }
  }
  return false;
}

async function waitForManualProgress(page, onEvent, { hint, detectDone, timeoutMs = MANUAL_TIMEOUT_MS }) {
  await onEvent("gmail_creator_manual_wait", { hint, url: page.url(), timeoutMs });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) {
      return { success: false, error: "browser_closed", failureReason: "browser_closed", url: "" };
    }
    if (await detectDone()) {
      await onEvent("gmail_creator_manual_completed", { hint, url: page.url() });
      return { success: true };
    }
    await delay(2000);
  }
  return {
    success: false,
    error: "gmail_creator_manual_timeout",
    failureReason: "manual_timeout",
    url: page.url()
  };
}

async function detectPhoneStep(page) {
  const url = page.url();
  if (/\/signin\/challenge\/iap|\/phone|\/verifyphone/i.test(url)) return true;
  if (await detectBirthdayStep(page)) return false;

  const phone = page.locator("input#phoneNumberId, input[name='phoneNumber'], input[autocomplete='tel'], input[aria-label*='phone' i], input[aria-label*='telefon' i]").first();
  if (await phone.isVisible({ timeout: 1200 }).catch(() => false)) return true;

  const phoneText = page.getByText(/enter a phone number|get a verification code|telefon numarası girin|doğrulama kodu/i).first();
  return phoneText.isVisible({ timeout: 1200 }).catch(() => false);
}

async function detectSmsCodeStep(page) {
  const code = page.locator('input[name="code"], input#code, input[autocomplete="one-time-code"]').first();
  return code.isVisible({ timeout: 1200 }).catch(() => false);
}

async function detectBirthdayStep(page) {
  if (/\/signup\/birthdaygender/i.test(page.url())) return true;

  const visible = await visibleFirst(page, [
    "input[name='day']",
    "input#day",
    "input[aria-label*='Day']",
    "input[aria-label*='Gün']"
  ], 1500);
  if (visible) return true;

  const heading = page.getByText(/basic information|enter your birthday and gender|doğum tarihinizi ve cinsiyetinizi/i).first();
  return heading.isVisible({ timeout: 1200 }).catch(() => false);
}

async function selectByNativeOrKeyboard(page, nativeSelector, labelPattern, optionIndex) {
  const native = page.locator(nativeSelector).first();
  if (await native.isVisible({ timeout: 1200 }).catch(() => false)) {
    await native.selectOption(String(optionIndex)).catch(async () => {
      await native.selectOption({ index: optionIndex }).catch(() => {});
    });
    return true;
  }

  const combo = page.getByRole("combobox", { name: labelPattern }).first();
  if (!(await combo.isVisible({ timeout: 1200 }).catch(() => false))) return false;

  await humanHoverClick(page, combo);
  await randomDelay(150, 350);
  const listboxId = await combo.getAttribute("aria-controls").catch(() => "");
  const scopedOption = listboxId
    ? page.locator(`#${listboxId} [role='option'][data-value='${optionIndex}']`).first()
    : null;
  if (scopedOption && await scopedOption.isVisible({ timeout: 1500 }).catch(() => false)) {
    await humanHoverClick(page, scopedOption);
    return true;
  }

  const option = page.locator(`[role='option'][data-value='${optionIndex}']`).first();
  if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
    await humanHoverClick(page, option);
    return true;
  }

  for (let index = 0; index < optionIndex; index += 1) {
    await page.keyboard.press("ArrowDown");
    await randomDelay(30, 90);
  }
  await page.keyboard.press("Enter");
  return true;
}

async function fillNameStep(page, identity, onEvent) {
  const first = await visibleFirst(page, ["input[name='firstName']", "input#firstName"]);
  const last = await visibleFirst(page, ["input[name='lastName']", "input#lastName"]);
  if (!first || !last) return false;

  await onEvent("gmail_creator_name_step_started", {});
  await humanHoverClick(page, first);
  await humanType(first, identity.firstName);
  await randomDelay(300, 700);
  await humanHoverClick(page, last);
  await humanType(last, identity.lastName);
  await randomDelay(400, 900);
  await clickNextButton(page);
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await randomDelay(1200, 2200);
  await onEvent("gmail_creator_name_step_completed", { url: page.url() });
  return true;
}

async function fillBirthdayStep(page, identity, onEvent) {
  const dayInput = await visibleFirst(page, [
    "input[name='day']",
    "input#day",
    "input[aria-label*='Day']",
    "input[aria-label*='Gün']"
  ]);
  if (!dayInput) return false;

  await onEvent("gmail_creator_birthday_step_started", {});
  const { day, month, year } = identity.birthday;

  await selectByNativeOrKeyboard(page, "select#month, select[name='month']", /month|ay/i, month);
  await randomDelay(200, 500);

  await humanHoverClick(page, dayInput);
  await humanType(dayInput, String(day));
  await randomDelay(200, 500);

  const yearInput = page.locator("input[name='year'], input#year, input[aria-label*='Year'], input[aria-label*='Yıl']").first();
  if (await yearInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanHoverClick(page, yearInput);
    await humanType(yearInput, String(year));
  }

  await selectByNativeOrKeyboard(page, "select#gender, select[name='gender']", /gender|cinsiyet/i, 1);

  await randomDelay(500, 1100);
  await clickNextButton(page);
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await randomDelay(1200, 2200);
  await onEvent("gmail_creator_birthday_step_completed", { url: page.url() });
  return true;
}

async function fillUsernameStep(page, identity, onEvent, usernameAttempt = 0) {
  const usernameInput = await visibleFirst(page, [
    "input[name='Username']",
    "input[name='username']",
    "input[aria-label*='Gmail']",
    "input[type='email']"
  ]);
  if (!usernameInput) return { filled: false, username: identity.username };

  const username = usernameAttempt > 0
    ? generateUsername({ firstName: identity.firstName, lastName: identity.lastName, attempt: usernameAttempt })
    : identity.username;

  await onEvent("gmail_creator_username_step_started", { username, attempt: usernameAttempt + 1 });
  await humanHoverClick(page, usernameInput);
  await usernameInput.fill("").catch(() => {});
  await humanType(usernameInput, username);
  await randomDelay(500, 1200);
  await clickNextButton(page);
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await randomDelay(1500, 2800);

  const warningText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const taken = /that username is taken|bu kullanıcı adı alınmış|not available|kullanılamıyor/i.test(warningText);
  if (taken && usernameAttempt < 4) {
    await onEvent("gmail_creator_username_taken", { username, attempt: usernameAttempt + 1 });
    return fillUsernameStep(page, identity, onEvent, usernameAttempt + 1);
  }

  await onEvent("gmail_creator_username_step_completed", { username, url: page.url() });
  return { filled: true, username, email: `${username}@gmail.com` };
}

async function fillPasswordStep(page, identity, onEvent) {
  const passwordInput = await visibleFirst(page, ["input[name='Passwd']", "input[type='password']"]);
  const confirmInput = page.locator("input[name='PasswdAgain']").first();
  if (!passwordInput) return false;

  await onEvent("gmail_creator_password_step_started", {});
  await humanHoverClick(page, passwordInput);
  await humanType(passwordInput, identity.password);
  await randomDelay(400, 900);

  if (await confirmInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanHoverClick(page, confirmInput);
    await humanType(confirmInput, identity.password);
  }

  await randomDelay(500, 1100);
  await clickNextButton(page);
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await randomDelay(1500, 2800);
  await onEvent("gmail_creator_password_step_completed", { url: page.url() });
  return true;
}

async function handleManualBlockers(page, onEvent) {
  const recaptcha = await detectRecaptchaChallenge(page);
  if (recaptcha) {
    const solved = await waitForManualRecaptchaIfNeeded(page, false, "", "", onEvent, MANUAL_TIMEOUT_MS, "");
    if (!solved.success) return solved;
  }

  if (await detectPhoneStep(page)) {
    await onEvent("gmail_creator_phone_manual_required", { url: page.url() });
    const phoneDone = await waitForManualProgress(page, onEvent, {
      hint: "Telefon numarası ve SMS kodunu tarayıcıda elle girin, sonra devam edin.",
      detectDone: async () => {
        if (isSignupSuccessUrl(page.url())) return true;
        if (!(await detectPhoneStep(page)) && !(await detectSmsCodeStep(page))) return true;
        return false;
      }
    });
    if (!phoneDone.success) return phoneDone;
  }

  if (await detectSmsCodeStep(page)) {
    await onEvent("gmail_creator_sms_manual_required", { url: page.url() });
    const smsDone = await waitForManualProgress(page, onEvent, {
      hint: "SMS doğrulama kodunu tarayıcıda girin.",
      detectDone: async () => isSignupSuccessUrl(page.url()) || !(await detectSmsCodeStep(page))
    });
    if (!smsDone.success) return smsDone;
  }

  return { success: true };
}

async function waitForManualBirthdayStep(page, onEvent) {
  await onEvent("gmail_creator_birthday_manual_required", { url: page.url() });
  return waitForManualProgress(page, onEvent, {
    hint: "Doğum tarihi ve cinsiyeti tarayıcıda elle seçip Next'e basın.",
    detectDone: async () => !(await detectBirthdayStep(page))
  });
}

async function runSignupWizard(page, identity, onEvent) {
  if (!(await fillNameStep(page, identity, onEvent))) {
    return { success: false, error: "gmail_creator_name_step_missing", failureReason: "signup_step", url: page.url() };
  }

  await handleManualBlockers(page, onEvent);

  if (!(await fillBirthdayStep(page, identity, onEvent))) {
    if (await detectBirthdayStep(page)) {
      const birthdayDone = await waitForManualBirthdayStep(page, onEvent);
      if (!birthdayDone.success) return birthdayDone;
    } else {
      return { success: false, error: "gmail_creator_birthday_step_missing", failureReason: "signup_step", url: page.url() };
    }
  }

  await handleManualBlockers(page, onEvent);

  const usernameResult = await fillUsernameStep(page, identity, onEvent);
  if (!usernameResult.filled) {
    return { success: false, error: "gmail_creator_username_step_missing", failureReason: "signup_step", url: page.url() };
  }

  identity.username = usernameResult.username;
  identity.email = usernameResult.email;

  await handleManualBlockers(page, onEvent);

  if (!(await fillPasswordStep(page, identity, onEvent))) {
    return { success: false, error: "gmail_creator_password_step_missing", failureReason: "signup_step", url: page.url() };
  }

  await handleManualBlockers(page, onEvent);

  // Google bazen ek adımlar (telefon, onay, captcha) gösterir — görünür modda insan tamamlar.
  if (!isSignupSuccessUrl(page.url())) {
    const finalWait = await waitForManualProgress(page, onEvent, {
      hint: "Kalan adımları (telefon, captcha, sözleşme) tarayıcıda tamamlayın.",
      detectDone: async () => isSignupSuccessUrl(page.url())
    });
    if (!finalWait.success) return finalWait;
  }

  return { success: true, url: page.url() };
}

async function createGmailAccount({
  identity,
  proxyUrl = "",
  deviceMode = "desktop",
  profileKey = "",
  onEvent = async () => {}
}) {
  const context = await launchBrowserContext({
    headless: false,
    deviceMode,
    proxyUrl,
    profileKey
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    await onEvent("gmail_creator_context_started", {
      email: identity.email,
      hasProxy: Boolean(proxyUrl),
      profileKey
    });

    if (process.env.GAUTH_WARMUP !== "0") {
      await warmUpSession(page, onEvent, { captchaApiKey: "", proxyUrl });
    }

    await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await randomDelay(1200, 2400);
    await humanMouseMove(page);
    await humanScroll(page);

    const wizard = await runSignupWizard(page, identity, onEvent);
    if (!wizard.success) {
      return wizard;
    }

    await page.goto("https://myaccount.google.com/", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => {});
    await randomDelay(1000, 2000);

    await onEvent("gmail_creator_completed", {
      email: identity.email,
      username: identity.username,
      url: page.url()
    });

    return {
      success: true,
      email: identity.email,
      password: identity.password,
      username: identity.username,
      firstName: identity.firstName,
      lastName: identity.lastName,
      birthday: identity.birthday,
      url: page.url()
    };
  } catch (error) {
    await onEvent("gmail_creator_failed", { error: error.message });
    return {
      success: false,
      error: error.message || "gmail_creator_failed",
      failureReason: "automation_error"
    };
  } finally {
    await context.close();
  }
}

module.exports = {
  createGmailAccount,
  SIGNUP_URL,
  MANUAL_TIMEOUT_MS
};
